import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Compass, FileText, LogOut, Pause, Play, Sparkles } from 'lucide-react'
import type { Evidence, Investigation } from '../lib/types'
import { api } from '../lib/api'
import { qk, useInvestigation, useTopology } from '../lib/hooks'
import { aggregate } from '../lib/observations'
import { Logo } from '../components/AppShell'
import { Button, InlineError, Mono, Segmented, StatusPill, VerdictBadge } from '../components/ui'
import { TopologyCanvas } from '../components/topology/TopologyCanvas'
import { EvidenceCard, VerificationRunCard } from '../components/evidence/Evidence'

type Story = 'vlan' | 'optical'
interface Ctx {
  inv?: Investigation
  ensure: () => Promise<string>
}
interface Step {
  title: string
  say: string
  action?: string // button label; no action = review step
  run?: (ctx: Ctx) => Promise<string[]> // evidence ids produced
  done: (inv?: Investigation) => boolean
  show?: 'verification' | 'report' | 'estimate' | 'symptom'
}

const diag = async (id: string, action: string, target: Record<string, unknown>, params: Record<string, unknown> = {}) => (await api.diagnostic(id, action, target, params)).evidence.id
const has = (inv: Investigation | undefined, pred: (e: Evidence) => boolean) => !!inv?.evidence.some((e) => e.phase === 'investigation' && pred(e))
const t = (e: Evidence, k: string) => e.target[k]

const STORIES: Record<Story, { title: string; scenario: string; tagline: string; steps: Step[] }> = {
  vlan: {
    title: 'A server is unreachable, but its physical link is up',
    scenario: 'wrong-vlan',
    tagline: 'Layer 2 configuration vs. physical failure',
    steps: [
      { title: 'Show the healthy baseline', say: 'Before anything breaks, I record what “working” looks like so recovery has something to be compared against.', action: 'Capture baseline', run: async (c) => (await api.baseline(await c.ensure())).evidence_ids, done: (i) => !!i && i.status !== 'opened' },
      { title: 'Introduce the wrong-VLAN fault', say: 'The simulation changes one piece of configuration state; the location stays hidden — I only get the symptom report.', action: 'Introduce fault', run: async (c) => (await api.injectFault(await c.ensure()), []), done: (i) => i?.execution.status === 'faulted', show: 'symptom' },
      { title: 'Show the failed endpoint check', say: 'Reproduce the symptom: Server A pings Server B. A failure here is a symptom — it does not tell me where the fault is.', action: 'Ping Server A → Server B', run: async (c) => [await diag(await c.ensure(), 'reachability', { src: 'srv-a', dst: 'srv-b' })], done: (i) => has(i, (e) => e.collector === 'reachability') },
      { title: 'Inspect administrative and operational link state', say: 'Before suspecting cables, check both ends: is the link configured up, and is it actually up?', action: 'Read both ends', run: async (c) => { const id = await c.ensure(); return [await diag(id, 'interface_state', { interface: 'asw-2:Ethernet1/1' }), await diag(id, 'interface_state', { interface: 'srv-b:eth0' })] }, done: (i) => has(i, (e) => e.collector === 'interface_state' && t(e, 'interface') === 'srv-b:eth0') },
      { title: 'Inspect VLAN membership', say: 'Link is up but ARP fails, so I compare the running VLAN configuration with documented intent.', action: 'Inspect VLANs on asw-2', run: async (c) => [await diag(await c.ensure(), 'vlan_membership', { device: 'asw-2' })], done: (i) => has(i, (e) => e.collector === 'vlan_membership') },
      {
        title: 'Record the diagnosis', say: 'I write the diagnosis down and cite the evidence that supports it — before changing anything.', action: 'Record diagnosis',
        run: async (c) => {
          const id = await c.ensure()
          const inv = await api.investigation(id)
          const cite = inv.evidence.filter((e) => e.phase === 'investigation' && ['reachability', 'interface_state', 'vlan_membership'].includes(e.collector)).map((e) => e.id)
          await api.diagnosis(id, 'l2_vlan', 'asw-2 Ethernet1/1 is running access VLAN 30; documented intent is VLAN 20. Physical link is up at both ends; ARP from Server A to 192.0.2.12 fails.', cite)
          return cite
        },
        done: (i) => !!i?.diagnosis,
      },
      { title: 'Apply the correction', say: 'Change only the mismatched port back to its intended VLAN. A repair is not a resolution.', action: 'Set asw-2 Eth1/1 → VLAN 20', run: async (c) => { const id = await c.ensure(); const inv = await api.repair(id, 'set_access_vlan', { interface: 'asw-2:Ethernet1/1' }, { vlan: 20 }); return inv.repairs.slice(-1).map((r) => r.evidence_id!).filter(Boolean) }, done: (i) => !!i?.repairs.length },
      { title: 'Verify connectivity and configuration', say: 'Scenario-specific checks: intended VLAN config, neighbor resolution, both directions, and throughput against baseline — not just one ping.', action: 'Run verification', run: async (c) => (await api.verify(await c.ensure())).verification.checks.flatMap((x) => x.evidence_ids), done: (i) => !!i?.verifications.length, show: 'verification' },
      { title: 'Show the evidence-backed report', say: 'Resolution is only allowed once the criteria are met; the report is built from stored evidence, not current state.', action: 'Resolve & open report', run: async (c) => { const id = await c.ensure(); const inv = await api.investigation(id); if (inv.status !== 'resolved' && inv.resolution_criteria.every((x) => x.met)) await api.resolve(id); return [] }, done: (i) => i?.status === 'resolved', show: 'report' },
    ],
  },
  optical: {
    title: 'Low receive power on a fiber link',
    scenario: 'low-rx-power',
    tagline: 'Interpreting optics without jumping to a root cause',
    steps: [
      { title: 'Show the healthy baseline', say: 'Record normal Tx/Rx at both ends of the Server A ↔ asw-1 optical path.', action: 'Capture baseline', run: async (c) => (await api.baseline(await c.ensure())).evidence_ids, done: (i) => !!i && i.status !== 'opened' },
      { title: 'A monitoring alarm arrives', say: 'Excess loss is introduced somewhere on the path; simulated monitoring polls DOM every 60 s and raises a low-warning.', action: 'Introduce fault', run: async (c) => { const id = await c.ensure(); const inv = await api.injectFault(id); return inv.evidence.filter((e) => e.collector === 'monitoring_alarm').map((e) => e.id) }, done: (i) => i?.execution.status === 'faulted', show: 'symptom' },
      { title: 'Read optics at both ends', say: 'Rx at asw-1 is below this module’s own low-warning threshold. That is evidence of a degraded path — not proof of a failed part.', action: 'Read optical telemetry', run: async (c) => [await diag(await c.ensure(), 'optical_telemetry', { interface: 'asw-1:Ethernet1/1' })], done: (i) => has(i, (e) => e.collector === 'optical_telemetry') },
      { title: 'Compare directions and the loss budget', say: 'Server A transmits normally and the reverse direction is healthy, so the excess loss is on one fiber toward asw-1. The figure is an estimate, not an OTDR result.', done: (i) => has(i, (e) => e.collector === 'optical_telemetry'), show: 'estimate' },
      { title: 'Trace the documented cable path', say: 'List every mated connection point between the two optics — each one is a candidate.', action: 'Trace documented path', run: async (c) => [await diag(await c.ensure(), 'cable_trace', { interface: 'srv-a:eth0' })], done: (i) => has(i, (e) => e.collector === 'cable_trace') },
      { title: 'Inspect connectors with a fiber scope', say: 'Working back from the affected receiver, inspect each mated point with a video probe — never by looking into the connector.', action: 'Inspect asw-1 port, then PP-02 F01', run: async (c) => { const id = await c.ensure(); return [await diag(id, 'connector_inspection', { location: 'asw-1:Ethernet1/1' }), await diag(id, 'connector_inspection', { location: 'pp-02:F01' })] }, done: (i) => has(i, (e) => e.collector === 'connector_inspection') },
      {
        title: 'Record the diagnosis', say: 'Now the evidence supports a specific location: low Rx narrowed it to a path; inspection identified the point.', action: 'Record diagnosis',
        run: async (c) => {
          const id = await c.ensure()
          const inv = await api.investigation(id)
          const cite = inv.evidence.filter((e) => e.phase === 'investigation' && ['optical_telemetry', 'connector_inspection', 'cable_trace'].includes(e.collector)).map((e) => e.id)
          await api.diagnosis(id, 'optical_path_degraded', 'Excess loss on the srv-a → asw-1 fiber. Scope inspection failed at PP-02 F01 (CBL-F201 end); other inspected points passed.', cite)
          return cite
        },
        done: (i) => !!i?.diagnosis,
      },
      { title: 'Clean, then re-inspect', say: 'Clean only the connector that failed inspection, re-inspect, and record the step.', action: 'Clean PP-02 F01', run: async (c) => { const id = await c.ensure(); const inv = await api.repair(id, 'clean_connector', { location: 'pp-02:F01' }); return inv.repairs.slice(-1).map((r) => r.evidence_id!).filter(Boolean) }, done: (i) => !!i?.repairs.length },
      { title: 'Verify and report', say: 'Rx inside thresholds at both ends, loss back near budget, link up, traffic healthy — then the evidence-backed report.', action: 'Verify & resolve', run: async (c) => { const id = await c.ensure(); const v = await api.verify(id); if (v.verification.passed) await api.resolve(id); return v.verification.checks.flatMap((x) => x.evidence_ids) }, done: (i) => i?.status === 'resolved' || !!i?.verifications.length, show: 'verification' },
    ],
  },
}

function EstimateView({ inv }: { inv: Investigation }) {
  const ev = [...inv.evidence].reverse().find((e) => e.collector === 'optical_telemetry' && e.phase === 'investigation')
  if (!ev) return null
  const est = (ev.payload.loss_estimates ?? []) as { direction: string; tx_dbm: number; rx_dbm: number; estimated_loss_db: number }[]
  const budget = ev.payload.planning_budget?.estimated_budget_db as number | undefined
  return (
    <div className="rounded-lg border border-line bg-white p-5 ">
      <div className="mb-3 flex items-center justify-between">
        <span className="eyebrow">Directional loss — from {ev.id}</span>
        <span className="rounded bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn">ESTIMATE · not OTDR</span>
      </div>
      <div className="space-y-3">
        {est.map((e, i) => {
          const pct = Math.min(100, (e.estimated_loss_db / 12) * 100)
          const high = budget != null && e.estimated_loss_db > budget + 1.5
          return (
            <div key={e.direction}>
              <div className="flex items-baseline justify-between font-mono text-[13px]">
                <span className="text-ink">{e.direction}</span>
                <span className={clsx('text-[18px] font-semibold', high ? 'text-crit' : 'text-ok')}>{e.estimated_loss_db.toFixed(2)} dB</span>
              </div>
              <div className="relative mt-1 h-3 overflow-hidden rounded-full bg-canvas">
                <motion.div className={clsx('h-full rounded-full', high ? 'bg-crit' : 'bg-ok')} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ delay: 0.2 + i * 0.25, duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                {budget != null && <span className="absolute inset-y-0 w-0.5 bg-nav" style={{ left: `${(budget / 12) * 100}%` }} title="Planning budget" />}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">
                Tx {e.tx_dbm.toFixed(2)} dBm − Rx {e.rx_dbm.toFixed(2)} dBm
              </div>
            </div>
          )
        })}
      </div>
      {budget != null && <p className="mt-3 text-[12.5px] text-muted">Black tick = documented planning budget ≈ {budget} dB (registry lengths × nominal attenuation + assumed mated-pair loss).</p>}
    </div>
  )
}

export default function Present() {
  const [sp, setSp] = useSearchParams()
  const story = (sp.get('story') === 'optical' ? 'optical' : 'vlan') as Story
  const invId = sp.get('inv') ?? undefined
  const S = STORIES[story]
  const qc = useQueryClient()
  const topo = useTopology()
  const inv = useInvestigation(invId)
  const [step, setStep] = useState(() => Number(sp.get('step') ?? 0))
  const [produced, setProduced] = useState<Record<number, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [paused, setPaused] = useState(false)
  const obs = useMemo(() => aggregate(inv.data, topo.data), [inv.data, topo.data])
  const cur = S.steps[step]

  const ensure = useCallback(async () => {
    if (invId) return invId
    const n = await api.createInvestigation(S.scenario, 'guided')
    setSp((p) => { p.set('inv', n.id); return p }, { replace: true })
    return n.id
  }, [invId, S.scenario, setSp])

  const go = useCallback((n: number) => {
    const k = Math.max(0, Math.min(S.steps.length - 1, n))
    setStep(k)
    setSp((p) => { p.set('step', String(k)); return p }, { replace: true })
  }, [S.steps.length, setSp])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return
      if (e.key === 'ArrowRight') go(step + 1)
      if (e.key === 'ArrowLeft') go(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, step])

  const runStep = async () => {
    if (!cur.run) return
    setBusy(true)
    setErr(null)
    try {
      const ids = await cur.run({ inv: inv.data, ensure })
      setProduced((p) => ({ ...p, [step]: ids }))
      const id = invId ?? sp.get('inv')
      if (id) await qc.invalidateQueries({ queryKey: qk.investigation(id) })
      else await qc.invalidateQueries({ queryKey: ['investigation'] })
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const switchStory = (s: Story) => setSp(new URLSearchParams({ story: s }))
  const done = cur.done(inv.data)
  const stepEvidence = (inv.data?.evidence ?? []).filter((e) => (produced[step] ?? []).includes(e.id))
  const fallback = !stepEvidence.length && done && inv.data ? [...inv.data.evidence].reverse().filter((e) => e.phase === 'investigation').slice(0, 1) : []
  const shown = (stepEvidence.length ? stepEvidence.slice(-2) : fallback).filter((e) => e.phase !== 'verification')
  const lastRun = inv.data?.verifications[inv.data.verifications.length - 1]

  return (
    <div className="flex h-full min-h-dvh flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-2.5 md:px-6">
        <Link to="/" aria-label="FiberScope workbench"><Logo className="size-7" /></Link>
        <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
          <div className="truncate text-[12px] text-muted">Guided walkthrough<span className="hidden sm:inline"> · {S.tagline}</span></div>
          <h1 className="truncate text-[16px] font-semibold text-ink">{S.title}</h1>
        </div>
        <div>
          <Segmented label="Demonstration story" value={story} onChange={switchStory} options={[{ value: 'vlan', label: 'Wrong VLAN' }, { value: 'optical', label: 'Low Rx power' }]} />
        </div>
                {invId && (
          <Link to={`/investigations/${invId}`} onClick={() => setPaused(true)}>
            <Button size="sm" variant="ghost" icon={<Pause className="size-3.5" aria-hidden />}>
              Pause & explore
            </Button>
          </Link>
        )}
        <Link to="/">
          <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" aria-hidden />}>
            Exit
          </Button>
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row md:p-5">
        {/* Step column */}
        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[400px] 2xl:w-[440px]">
          <div className="relative overflow-hidden rounded-lg border border-line bg-white p-5">
            <div className="absolute inset-x-0 top-0 h-1 bg-canvas">
              <motion.div className="h-full bg-accent" animate={{ width: `${((step + 1) / S.steps.length) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={`${story}-${step}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-md bg-nav font-mono text-[14px] font-bold text-white">{step + 1}</span>
                  <span className="font-mono text-[12px] text-faint">
                    of {S.steps.length}
                  </span>
                  {done && <span className="ml-auto rounded-md bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">Step performed</span>}
                </div>
                <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{cur.title}</h2>
                <p className="mt-2 text-[15.5px] leading-relaxed text-muted">{cur.say}</p>
                {cur.action && (
                  <Button size="lg" variant={done ? 'secondary' : 'primary'} className="mt-4 w-full" loading={busy} onClick={runStep} icon={<Play className="size-4" aria-hidden />}>
                    {done ? `Run again: ${cur.action}` : cur.action}
                  </Button>
                )}
                {!cur.action && <p className="mt-4 rounded-lg bg-canvas px-3 py-2 text-[12.5px] text-muted"><Compass className="mr-1 inline size-3.5" aria-hidden />Review step — explain using the evidence on the right.</p>}
                <InlineError error={err} />
              </motion.div>
            </AnimatePresence>
            <div className="mt-4 flex items-center justify-between border-t border-line-2 pt-3">
              <Button size="sm" variant="ghost" disabled={step === 0} onClick={() => go(step - 1)} icon={<ArrowLeft className="size-4" aria-hidden />}>
                Back
              </Button>
              <span className="hidden font-mono text-[10.5px] text-faint sm:inline">← → keys</span>
              <Button size="sm" variant={done || !cur.action ? 'primary' : 'secondary'} disabled={step === S.steps.length - 1} onClick={() => go(step + 1)}>
                Next <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <ol className="scroll-thin hidden flex-1 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-white p-2 lg:block" aria-label="Demonstration steps">
            {S.steps.map((s, i) => {
              const d = s.done(inv.data)
              return (
                <li key={s.title}>
                  <button onClick={() => go(i)} aria-current={i === step ? 'step' : undefined} className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors', i === step ? 'bg-accent-soft font-semibold text-ink' : 'text-muted hover:bg-canvas')}>
                    <span className={clsx('grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold', d ? 'bg-accent text-white' : i === step ? 'border-2 border-accent text-accent' : 'border border-line text-faint')}>{d ? '✓' : i + 1}</span>
                    {s.title}
                  </button>
                </li>
              )
            })}
          </ol>
          {paused && <p className="text-[12px] text-muted">Paused — continue any time.</p>}
        </aside>

        {/* Stage */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" aria-label="Demonstration stage">
          <div className="relative min-h-[380px] flex-[1.3] overflow-hidden rounded-lg border border-line bg-white">
            {topo.data && <TopologyCanvas topo={topo.data} obs={obs} selection={null} onSelect={() => {}} focus={{ src: 'srv-a', dst: 'srv-b' }} compactToolbar initialMode={typeof window !== 'undefined' && window.innerWidth < 768 ? 'list' : 'graph'} autoTrace={story === 'optical' && step >= 4} key={`${story}-${step >= 4}`} />}
          </div>
          <div className="scroll-thin min-h-[220px] flex-1 space-y-3 overflow-y-auto">
            {inv.data && (
              <div className="flex flex-wrap items-center gap-2">
                <Mono className="text-muted">{inv.data.id}</Mono>
                <StatusPill status={inv.data.status} />
                <span className="text-[12px] text-faint">· Results below come from the API response, not from this script.</span>
              </div>
            )}
            <AnimatePresence mode="popLayout">
              {cur.show === 'symptom' && inv.data?.symptom && (
                <motion.blockquote key="symptom" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border-l-4 border-crit bg-white p-5 text-[17px] leading-relaxed text-ink ">
                  <div className="eyebrow mb-1 text-crit">Symptom report</div>“{inv.data.symptom}”
                </motion.blockquote>
              )}
              {cur.show === 'estimate' && inv.data && <EstimateView key="est" inv={inv.data} />}
              {cur.show === 'verification' && lastRun && <VerificationRunCard key={lastRun.id} run={lastRun} evidence={inv.data?.evidence} />}
              {cur.show === 'report' && inv.data && (
                <motion.div key="report" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-lg border border-line bg-white p-5 ">
                  <div className="flex flex-wrap items-center gap-3">
                    <Sparkles className="size-5 text-accent" aria-hidden />
                    <div className="flex-1">
                      <div className="text-[16px] font-semibold text-ink">{inv.data.status === 'resolved' ? 'Resolved — every criterion met' : 'Not resolved yet'}</div>
                      <div className="text-[13px] text-muted">
                        {inv.data.evidence.length} evidence items · {inv.data.metrics.counts.diagnostic_actions} diagnostic actions · {inv.data.metrics.counts.failed_verifications} failed verifications
                      </div>
                    </div>
                    <Link to={`/reports/${inv.data.id}`}>
                      <Button variant="primary" icon={<FileText className="size-4" aria-hidden />}>Open report</Button>
                    </Link>
                  </div>
                  <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                    {inv.data.resolution_criteria.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-[13px]">
                        <span className={c.met ? 'text-ok' : 'text-faint'}>{c.met ? '✓' : '○'}</span>
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
              {cur.show !== 'verification' && shown.map((e) => (
                <motion.div key={e.id} layout>
                  <div className="mb-1 flex items-center gap-2">
                    <VerdictBadge verdict={e.verdict} />
                    <span className="text-[12px] text-muted">Evidence {e.id}</span>
                  </div>
                  <EvidenceCard e={e} large />
                </motion.div>
              ))}
            </AnimatePresence>
            {!inv.data && <p className="rounded-lg border border-dashed border-line bg-white p-6 text-center text-[14px] text-muted">Press <b className="text-ink">{S.steps[0].action}</b> to create a fresh guided investigation for this story.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
