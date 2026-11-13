import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { CheckCircle2, ChevronDown, ChevronUp, Circle, ClipboardList, Compass, FileText, Lightbulb, MoreHorizontal, PlayCircle, Repeat, RotateCcw, ShieldCheck, Stethoscope, Undo2, Wrench, X, XOctagon, Zap } from 'lucide-react'
import type { Evidence, Investigation, InvestigationSummary, Topology } from '../../lib/types'
import { aggregate } from '../../lib/observations'
import { api } from '../../lib/api'
import { useCatalog, useInvMutation, useScenarios } from '../../lib/hooks'
import { STATUS_LABEL } from '../../lib/format'
import { Button, Dialog, EmptyState, InlineError, LoadingBlock, Mono } from '../ui'
import { TopologyCanvas, type Selection } from '../topology/TopologyCanvas'
import { EvidenceCard, Timeline, VerificationRunCard } from '../evidence/Evidence'
import { Stepper } from './Stepper'
import { ActionPalette } from './ActionPalette'
import { CasePanel } from './CasePanel'
import { RepairPanel } from './RepairPanel'
import { Inspector } from './Inspector'

type PanelMode = 'inspect' | 'check' | 'case' | 'repair'
const PANEL_TITLE: Record<PanelMode, string> = { inspect: 'Inspector', check: 'Run check', case: 'Case notes', repair: 'Repair & verify' }

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

function StageButton({ inv }: { inv: Investigation }) {
  const failed = inv.status === 'verification_failed'
  return (
    <Popover.Root>
      <Popover.Trigger className={clsx('flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/30', failed ? 'border-[#ecc5ca] bg-crit-soft text-crit' : 'border-line bg-white text-ink hover:bg-canvas')}>
        <span className={clsx('size-1.5 rounded-full', failed ? 'bg-crit' : inv.status === 'resolved' ? 'bg-ok' : inv.status === 'abandoned' ? 'bg-faint' : 'bg-accent')} aria-hidden />
        <span className="text-muted">Stage</span> {STATUS_LABEL[inv.status]}
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[60] w-[320px] rounded-lg border border-line bg-white p-4 shadow-[var(--shadow-pop)]">
          <div className="mb-3 text-[13px] font-semibold text-ink">Workflow</div>
          <Stepper status={inv.status} vertical />
          <div className="mt-4 border-t border-line-2 pt-3">
            <div className="mb-1.5 text-[12px] font-semibold text-muted">Resolution criteria</div>
            <ul className="space-y-1">
              {inv.resolution_criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                  {c.met ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-ok" aria-hidden /> : <Circle className="mt-px size-3.5 shrink-0 text-[#c9c4cf]" aria-hidden />}
                  <span className={c.met ? 'text-ink' : 'text-muted'}>{c.label}</span>
                  <span className="sr-only">{c.met ? 'met' : 'not met'}</span>
                </li>
              ))}
            </ul>
          </div>
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface NextAction {
  label: string
  icon: ReactNode
  hint: string
  run: () => void
  pending?: boolean
  err?: unknown
}

/** One dominant next action, derived from investigation state. */
function useNextAction(inv: Investigation | undefined, openPanel: (m: PanelMode) => void, onVerified: () => void): NextAction | null {
  const nav = useNavigate()
  const base = useInvMutation(inv?.id, () => api.baseline(inv!.id))
  const fault = useInvMutation(inv?.id, () => api.injectFault(inv!.id))
  const verify = useInvMutation(inv?.id, async (_: void) => {
    const r = await api.verify(inv!.id)
    onVerified()
    return r
  })
  const resolve = useInvMutation(inv?.id, () => api.resolve(inv!.id))
  if (!inv) return null
  const invEvidence = inv.evidence.filter((e) => e.phase === 'investigation').length
  const s = inv.status
  const err = base.error ?? fault.error ?? verify.error ?? resolve.error
  if (s === 'opened') return { label: 'Capture baseline', icon: <ShieldCheck className="size-4" />, hint: 'Record the healthy state first — recovery is compared against it.', run: () => base.mutate(), pending: base.isPending, err }
  if (s === 'baseline_reviewed' && inv.execution.status === 'baseline') return { label: 'Introduce fault', icon: <Zap className="size-4" />, hint: 'One hidden change is made; you receive only the symptom.', run: () => fault.mutate(), pending: fault.isPending, err }
  if (s === 'verification_failed') return { label: 'Run check', icon: <Stethoscope className="size-4" />, hint: 'Verification failed — investigate further before another repair.', run: () => openPanel('check') }
  if (s === 'investigating' && !inv.diagnosis)
    return invEvidence < 2
      ? { label: 'Run check', icon: <Stethoscope className="size-4" />, hint: 'Reproduce the symptom, then narrow it down.', run: () => openPanel('check') }
      : { label: 'Record diagnosis', icon: <ClipboardList className="size-4" />, hint: 'Cite the evidence that supports it.', run: () => openPanel('case') }
  if (s === 'diagnosis_recorded' || s === 'investigating') return { label: 'Apply repair', icon: <Wrench className="size-4" />, hint: 'Change only what the diagnosis identifies.', run: () => openPanel('repair') }
  if (s === 'repair_applied') return { label: 'Verify recovery', icon: <ShieldCheck className="size-4" />, hint: 'Runs every recovery check for this scenario.', run: () => verify.mutate(), pending: verify.isPending, err }
  if (s === 'verifying') return { label: 'Resolve', icon: <CheckCircle2 className="size-4" />, hint: 'Verification passed — all criteria are met.', run: () => resolve.mutate(), pending: resolve.isPending, err }
  return { label: 'View report', icon: <FileText className="size-4" />, hint: s === 'resolved' ? 'Resolved with evidence.' : 'Closed without success.', run: () => nav(`/reports/${inv.id}`) }
}

function MoreMenu({ inv, investigations }: { inv: Investigation; investigations?: InvestigationSummary[] }) {
  const nav = useNavigate()
  const [confirm, setConfirm] = useState<null | 'abandon' | 'reset'>(null)
  const [reason, setReason] = useState('')
  const abandon = useInvMutation(inv.id, () => api.abandon(inv.id, reason))
  const reset = useInvMutation(inv.id, () => api.reset(inv.id))
  const reopen = useInvMutation(inv.id, () => api.reopen(inv.id, 'Reopened from workbench'))
  const closed = inv.status === 'resolved' || inv.status === 'abandoned'
  const others = (investigations ?? []).filter((i) => i.id !== inv.id && i.status !== 'resolved' && i.status !== 'abandoned').slice(0, 6)
  const item = 'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-accent-soft'
  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger className="grid size-9 place-items-center rounded-md border border-line bg-white text-muted outline-none hover:bg-canvas hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30" aria-label="More investigation actions">
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={4} className="z-[60] w-[260px] rounded-lg border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
            {others.length > 0 && (
              <>
                <Menu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Resume investigation</Menu.Label>
                {others.map((o) => (
                  <Menu.Item key={o.id} className={item} onSelect={() => nav(`/investigations/${o.id}`)}>
                    <Mono className="text-muted">{o.id}</Mono>
                    <span className="truncate">{o.scenario.title}</span>
                  </Menu.Item>
                ))}
                <Menu.Separator className="my-1 h-px bg-line-2" />
              </>
            )}
            <Menu.Item className={item} onSelect={() => nav('/scenarios')}>
              <PlayCircle className="size-4 text-muted" aria-hidden /> Start another investigation
            </Menu.Item>
            <Menu.Item className={item} onSelect={() => nav('/present')}>
              <Compass className="size-4 text-muted" aria-hidden /> Guided walkthrough
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-line-2" />
            {inv.status === 'resolved' && (
              <Menu.Item className={item} onSelect={() => reopen.mutate()}>
                <Undo2 className="size-4 text-muted" aria-hidden /> Reopen
              </Menu.Item>
            )}
            <Menu.Item
              className={item}
              onSelect={async () => {
                const n = await api.restart(inv.id)
                nav(`/investigations/${n.id}`)
              }}
            >
              <Repeat className="size-4 text-muted" aria-hidden /> Restart as new drill
            </Menu.Item>
            {inv.execution.status !== 'reset' && (
              <Menu.Item className={item} onSelect={() => setConfirm('reset')}>
                <RotateCcw className="size-4 text-muted" aria-hidden /> Reset simulation
              </Menu.Item>
            )}
            {!closed && (
              <Menu.Item className={clsx(item, 'text-crit')} onSelect={() => setConfirm('abandon')}>
                <XOctagon className="size-4" aria-hidden /> Abandon drill
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <Dialog open={confirm === 'abandon'} onOpenChange={(o) => !o && setConfirm(null)} title="Abandon this drill?" description="Closes the investigation without marking it successful. Evidence is kept.">
        <label htmlFor="abandon-reason" className="label">
          Reason
        </label>
        <input id="abandon-reason" className="field mb-4" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. out of time" />
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" loading={abandon.isPending} onClick={() => abandon.mutate(undefined, { onSuccess: () => setConfirm(null) })}>
            Abandon
          </Button>
        </div>
        <InlineError error={abandon.error} />
      </Dialog>
      <Dialog open={confirm === 'reset'} onOpenChange={(o) => !o && setConfirm(null)} title="Reset this simulation?" description={`Restores ${inv.execution.id} to the healthy baseline. Only this drill is affected and its evidence is kept; an unresolved drill is closed as abandoned.`}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="primary" loading={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: () => setConfirm(null) })}>
            Reset to baseline
          </Button>
        </div>
      </Dialog>
    </>
  )
}

function StartControls({ investigations }: { investigations?: InvestigationSummary[] }) {
  const nav = useNavigate()
  const sc = useScenarios()
  const [key, setKey] = useState('wrong-vlan')
  const start = useInvMutation(undefined, async (_: void) => {
    const n = await api.createInvestigation(key, 'guided')
    nav(`/investigations/${n.id}`)
    return n
  })
  const active = (investigations ?? []).find((i) => i.status !== 'resolved' && i.status !== 'abandoned')
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active && (
        <Link to={`/investigations/${active.id}`}>
          <Button>Resume {active.id}</Button>
        </Link>
      )}
      <label className="sr-only" htmlFor="start-scenario">
        Scenario
      </label>
      <select id="start-scenario" className="h-9 rounded-md border border-line bg-white px-2 text-[13px] text-ink" value={key} onChange={(e) => setKey(e.target.value)}>
        {(sc.data?.scenarios ?? []).map((s) => (
          <option key={s.key} value={s.key}>
            {s.title}
          </option>
        ))}
      </select>
      <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()} icon={<PlayCircle className="size-4" aria-hidden />}>
        Start investigation
      </Button>
      <InlineError error={start.error} />
    </div>
  )
}

function Tray({ inv, open, setOpen, tab, setTab, fresh }: { inv: Investigation; open: boolean; setOpen: (o: boolean) => void; tab: string; setTab: (t: string) => void; fresh: string | null }) {
  const [phase, setPhase] = useState<'all' | Evidence['phase']>('all')
  const evidence = useMemo(() => [...inv.evidence].reverse().filter((e) => phase === 'all' || e.phase === phase), [inv, phase])
  const lastRun = inv.verifications[inv.verifications.length - 1]
  const tabs = [
    { key: 'evidence', label: 'Evidence', count: inv.evidence.length },
    { key: 'timeline', label: 'Timeline', count: inv.timeline.length },
    { key: 'verification', label: 'Verification', count: inv.verifications.length },
  ]
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 bottom-11 z-20 flex h-[min(55%,460px)] flex-col border-t border-line bg-white shadow-[0_-8px_24px_rgb(36_35_41/0.06)]"
            aria-label={`${tab} tray`}
          >
            {tab === 'evidence' && (
              <div className="flex shrink-0 items-center justify-end border-b border-line-2 px-3 py-1.5">
                <label className="sr-only" htmlFor="phase-filter">
                  Filter evidence by phase
                </label>
                <select id="phase-filter" className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px]" value={phase} onChange={(e) => setPhase(e.target.value as typeof phase)}>
                  <option value="all">All phases</option>
                  <option value="baseline">Baseline</option>
                  <option value="investigation">Investigation</option>
                  <option value="repair">Repair</option>
                  <option value="verification">Verification</option>
                </select>
              </div>
            )}
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
              {tab === 'evidence' &&
                (evidence.length ? (
                  <div className="grid gap-2 2xl:grid-cols-2">
                    {evidence.map((e) => (
                      <EvidenceCard key={e.id} e={e} highlight={fresh === e.id} cited={inv.diagnosis_evidence_ids.includes(e.id)} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No evidence yet">Capture the baseline or run a check.</EmptyState>
                ))}
              {tab === 'timeline' && <Timeline events={[...inv.timeline].reverse()} simulated={inv.execution.source_mode === 'SIMULATED'} />}
              {tab === 'verification' &&
                (inv.verifications.length ? (
                  <div className="space-y-3">
                    {[...inv.verifications].reverse().map((v) => (
                      <VerificationRunCard key={v.id} run={v} evidence={inv.evidence} animate={v.id === lastRun?.id} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No verification runs">After a repair, use Verify recovery.</EmptyState>
                ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <div className="relative z-30 flex h-11 shrink-0 items-center gap-1 border-t border-line bg-white px-2" role="toolbar" aria-label="Evidence tray">
        {tabs.map((t) => {
          const on = open && tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => {
                if (on) setOpen(false)
                else {
                  setTab(t.key)
                  setOpen(true)
                }
              }}
              aria-expanded={on}
              className={clsx('relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors', on ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-canvas hover:text-ink')}
            >
              {t.label}
              <motion.span key={`${t.key}-${t.count}`} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className={clsx('rounded px-1 font-mono text-[11px]', on ? 'bg-white/70' : 'bg-canvas')}>
                {t.count}
              </motion.span>
              {t.key === 'evidence' && fresh && !on && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-label="New evidence" />}
            </button>
          )
        })}
        <button onClick={() => setOpen(!open)} className="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-canvas" aria-label={open ? 'Collapse tray' : 'Expand tray'} aria-expanded={open}>
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
      </div>
    </>
  )
}

function SidePanel({ mode, setMode, onClose, children, showWorkflowTabs }: { mode: PanelMode; setMode: (m: PanelMode) => void; onClose: () => void; children: ReactNode; showWorkflowTabs: boolean }) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-40 flex flex-col border-l border-line bg-white md:static md:z-auto md:w-[380px] md:shrink-0 2xl:w-[420px]"
      aria-label={PANEL_TITLE[mode]}
    >
      <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line-2 px-2">
        {(showWorkflowTabs ? (['inspect', 'check', 'case', 'repair'] as const) : (['inspect'] as const)).map((m) => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={clsx('h-8 whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium transition-colors', mode === m ? 'bg-accent-soft text-accent-strong' : 'text-muted hover:bg-canvas hover:text-ink')}>
            {PANEL_TITLE[m]}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto grid size-8 place-items-center rounded-md text-muted hover:bg-canvas hover:text-ink" aria-label="Close panel">
          <X className="size-4" />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
    </motion.aside>
  )
}

export function Workbench({ topo, inv, investigations }: { topo: Topology; inv?: Investigation; investigations?: InvestigationSummary[] }) {
  const cat = useCatalog()
  const narrow = useIsNarrow()
  const obs = useMemo(() => aggregate(inv, topo), [inv, topo])
  const [selection, setSelection] = useState<Selection>(null)
  const [panel, setPanel] = useState<PanelMode | null>(null)
  const [trayOpen, setTrayOpen] = useState(false)
  const [trayTab, setTrayTab] = useState('evidence')
  const [fresh, setFresh] = useState<string | null>(null)
  const [latest, setLatest] = useState<string | null>(null)
  const [hintsOpen, setHintsOpen] = useState(false)
  const focus = inv?.focus ?? { src: 'srv-a', dst: 'srv-b' }
  const closed = !!inv && (inv.status === 'resolved' || inv.status === 'abandoned')

  const onSelect = useCallback((s: Selection) => {
    setSelection(s)
    if (s) setPanel((p) => (p === 'case' || p === 'repair' ? p : 'inspect'))
    else setPanel((p) => (p === 'inspect' ? null : p))
  }, [])
  const onEvidence = useCallback((e: Evidence) => {
    setLatest(e.id)
    setFresh(e.id)
  }, [])
  const openPanel = useCallback((m: PanelMode) => setPanel(m), [])
  const next = useNextAction(inv, openPanel, () => {
    setTrayTab('verification')
    setTrayOpen(true)
  })
  useEffect(() => {
    if (trayOpen && trayTab === 'evidence') setFresh(null)
  }, [trayOpen, trayTab])

  const latestEv = latest ? inv?.evidence.find((e) => e.id === latest) : undefined
  const latestBlock = latestEv && (
    <div className="border-b border-line-2 bg-canvas/60 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted">Latest result</span>
        <button
          className="text-[12px] font-medium text-accent hover:underline"
          onClick={() => {
            setTrayTab('evidence')
            setTrayOpen(true)
          }}
        >
          All evidence
        </button>
      </div>
      <EvidenceCard key={latestEv.id} e={latestEv} />
    </div>
  )

  return (
    <div className="flex h-full min-h-[600px] flex-col">
      {/* Investigation toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-white px-4 py-2 md:px-5">
        <div className="flex min-w-0 flex-1 basis-[260px] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-[15.5px] font-semibold text-ink">{inv ? inv.scenario.title : (topo.environment?.name ?? 'North Lab Fabric')}</h1>
              {inv && <Mono className="shrink-0 text-[11.5px] text-faint">{inv.id}</Mono>}
            </div>
            <p className="truncate text-[12px] text-muted" title={inv?.symptom || undefined}>
              {inv ? inv.symptom || next?.hint : 'Documented inventory — start an investigation to collect evidence.'}
            </p>
          </div>
          {inv && <StageButton inv={inv} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {inv && next ? (
            <>
              <Button variant="primary" loading={next.pending} onClick={next.run} icon={next.icon}>
                {next.label}
              </Button>
              {next.label !== 'View report' && (
                <Link to={`/reports/${inv.id}`}>
                  <Button icon={<FileText className="size-4" aria-hidden />}>Report</Button>
                </Link>
              )}
              <MoreMenu inv={inv} investigations={investigations} />
            </>
          ) : (
            <StartControls investigations={investigations} />
          )}
        </div>
        {next?.err ? (
          <div className="basis-full">
            <InlineError error={next.err} />
          </div>
        ) : null}
      </div>

      {/* Canvas + contextual panel */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <TopologyCanvas
              key={narrow ? 'narrow' : 'wide'}
              topo={topo}
              obs={obs}
              selection={selection}
              onSelect={onSelect}
              focus={focus}
              initialMode={narrow ? 'list' : 'graph'}
              note={inv ? null : 'Inventory model — not observed device health'}
              actions={
                inv ? (
                  <div className="mr-1 hidden items-center overflow-hidden rounded-md border border-line md:flex" role="group" aria-label="Investigation tools">
                    {(['check', 'case', 'repair'] as const).map((m) => (
                      <button key={m} onClick={() => setPanel(m)} aria-pressed={panel === m} className={clsx('flex h-7 items-center gap-1.5 border-r border-line-2 px-2.5 text-[12.5px] font-medium last:border-r-0', panel === m ? 'bg-accent-soft text-accent-strong' : 'text-ink hover:bg-canvas')}>
                        {m === 'check' ? <Stethoscope className="size-3.5 text-muted" aria-hidden /> : m === 'case' ? <ClipboardList className="size-3.5 text-muted" aria-hidden /> : <Wrench className="size-3.5 text-muted" aria-hidden />}
                        {PANEL_TITLE[m]}
                      </button>
                    ))}
                  </div>
                ) : null
              }
            />
          </div>
          {inv && <Tray inv={inv} open={trayOpen} setOpen={setTrayOpen} tab={trayTab} setTab={setTrayTab} fresh={fresh} />}
        </div>
        <AnimatePresence>
          {panel && (
            <SidePanel key="panel" mode={panel} setMode={setPanel} onClose={() => setPanel(null)} showWorkflowTabs={!!inv}>
              {panel === 'inspect' &&
                (selection ? (
                  <>
                    {latestBlock}
                    <div className="p-4">
                      <Inspector topo={topo} obs={obs} selection={selection} inv={inv} onEvidence={onEvidence} onSelect={onSelect} />
                    </div>
                  </>
                ) : (
                  <p className="p-4 text-[13px] text-muted">Select a device, port or cable on the canvas.</p>
                ))}
              {panel === 'check' && inv && (
                <>
                  {latestBlock}
                  <div className="p-3">
                    {!cat.data ? (
                      <LoadingBlock />
                    ) : (
                      <>
                        {inv.mode === 'guided' && inv.scenario_definition.hints && (
                          <div className="mb-3 rounded-md border border-line">
                            <button onClick={() => setHintsOpen((o) => !o)} aria-expanded={hintsOpen} className="flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] font-medium text-ink">
                              <span className="flex items-center gap-1.5">
                                <Lightbulb className="size-3.5 text-muted" aria-hidden /> Suggested approach
                              </span>
                              <ChevronDown className={clsx('size-3.5 text-muted transition-transform', hintsOpen && 'rotate-180')} aria-hidden />
                            </button>
                            {hintsOpen && (
                              <ol className="space-y-1 px-3 pb-3">
                                {inv.scenario_definition.hints.map((h, i) => (
                                  <li key={h} className="flex gap-2 text-[12.5px] leading-relaxed text-ink/85">
                                    <span className="font-mono text-[11px] text-faint">{i + 1}.</span>
                                    {h}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        )}
                        <ActionPalette
                          inv={inv}
                          cat={cat.data}
                          selection={selection}
                          onEvidence={onEvidence}
                          disabledReason={closed ? `Investigation is ${STATUS_LABEL[inv.status].toLowerCase()}.` : inv.status === 'opened' ? 'Capture the baseline first.' : null}
                        />
                      </>
                    )}
                  </div>
                </>
              )}
              {panel === 'case' && inv && (
                <div className="p-4">
                  <CasePanel key={inv.id} inv={inv} />
                </div>
              )}
              {panel === 'repair' && inv && (
                <div className="p-4">
                  {cat.data ? (
                    <RepairPanel
                      key={inv.id}
                      inv={inv}
                      cat={cat.data}
                      onVerified={() => {
                        setTrayTab('verification')
                        setTrayOpen(true)
                      }}
                    />
                  ) : (
                    <LoadingBlock />
                  )}
                </div>
              )}
            </SidePanel>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
