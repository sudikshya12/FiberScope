import { useState } from 'react'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { AlertOctagon, BellRing, CheckCircle2, ChevronDown, CircleDot, ClipboardCheck, FileSearch, Fingerprint, FlaskConical, Lightbulb, RotateCcw, ShieldCheck, Stethoscope, Wrench, XCircle } from 'lucide-react'
import type { Evidence, TimelineEvent, VerificationRun } from '../../lib/types'
import { fmtSim, fmtTime } from '../../lib/format'
import { Badge, EmptyState, Mono, RawOutput, SourceBadge, VerdictBadge } from '../ui'

const PHASE: Record<Evidence['phase'], { label: string; cls: string }> = {
  baseline: { label: 'Baseline', cls: 'bg-[#f1eff3] text-[#4a4752]' },
  investigation: { label: 'Investigation', cls: 'bg-accent-soft text-accent-strong' },
  verification: { label: 'Verification', cls: 'bg-ok-soft text-ok' },
  repair: { label: 'Repair', cls: 'bg-warn-soft text-warn' },
}

const VERDICT_BAR: Record<string, string> = { ok: 'bg-ok', warning: 'bg-warn', fail: 'bg-crit', info: 'bg-[#c9c4cf]' }

function chips(o: Record<string, unknown>) {
  return Object.entries(o).map(([k, v]) => (
    <span key={k} className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
      <span className="text-faint">{k}</span>
      <span className="text-ink">{Array.isArray(v) ? v.join(',') : String(v)}</span>
    </span>
  ))
}

export function EvidenceCard({ e, defaultOpen = false, highlight = false, cited = false, large = false }: { e: Evidence; defaultOpen?: boolean; highlight?: boolean; cited?: boolean; large?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={clsx('relative overflow-hidden rounded-lg border bg-white transition-shadow', highlight ? 'border-accent/60 shadow-[0_0_0_3px_rgb(105_65_198/0.10)]' : 'border-line hover:border-[#d6d1dc]')}
      aria-labelledby={`ev-${e.id}`}
    >
      <span className={clsx('absolute inset-y-0 left-0 w-[3px]', VERDICT_BAR[e.verdict])} aria-hidden />
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 py-2.5 pl-4 pr-3 text-left hover:bg-[#fbfafc]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <VerdictBadge verdict={e.verdict} />
            <h3 id={`ev-${e.id}`} className={clsx('min-w-0 truncate font-semibold leading-snug text-ink', large ? 'text-[16px]' : 'text-[13.5px]')}>
              {e.title}
            </h3>
            {cited && <Badge tone="dark">Cited</Badge>}
            {e.source_mode !== 'SIMULATED' && <SourceBadge mode={e.source_mode} />}
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">{fmtTime(e.collected_at)}</span>
          </div>
          <p className={clsx('mt-1 text-muted', large ? 'text-[14.5px] leading-relaxed' : 'line-clamp-1 text-[12.5px] leading-relaxed', open && 'line-clamp-none')}>{e.interpretation}</p>
        </div>
        <ChevronDown className={clsx('mt-1 size-4 shrink-0 text-faint transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="space-y-3 border-t border-line-2 py-3 pl-4 pr-3">
              <div className="grid gap-2 text-[12px] sm:grid-cols-2">
                <div>
                  <div className="eyebrow mb-1">Purpose</div>
                  <p className="text-ink/90">{e.purpose}</p>
                </div>
                <div>
                  <div className="eyebrow mb-1">Target & parameters</div>
                  <div className="flex flex-wrap gap-1">
                    {chips(e.target)}
                    {chips(e.params)}
                  </div>
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">Equivalent command / collector</div>
                <code className="block break-all rounded-md bg-canvas px-2 py-1.5 font-mono text-[11.5px] text-ink">{e.command}</code>
              </div>
              <RawOutput text={e.raw_output} simulated={e.source_mode === 'SIMULATED'} />
              {e.next_steps.length > 0 && (
                <div className="rounded-lg border border-accent/25 bg-accent-soft/50 p-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-accent-strong">
                    <Lightbulb className="size-3.5" aria-hidden /> Suggested next checks (guided mode)
                  </div>
                  <ul className="list-inside list-disc space-y-0.5 text-[12px] text-ink/85">
                    {e.next_steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="eyebrow mb-1">Limitations</div>
                <ul className="space-y-0.5 text-[11.5px] text-muted">
                  {e.limitations.map((l) => (
                    <li key={l} className="flex gap-1.5">
                      <span className="text-faint" aria-hidden>
                        –
                      </span>
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-line pt-2 font-mono text-[10.5px] text-faint">
                <span className="flex items-center gap-1">
                  <Fingerprint className="size-3" aria-hidden /> sha256 {e.content_sha256.slice(0, 16)}…
                </span>
                <span>{e.id}</span>
                <span className={clsx('rounded px-1', PHASE[e.phase].cls)}>{PHASE[e.phase].label}</span>
                <span>source {e.source_mode}{e.source_mode === 'SIMULATED' && e.sim_time_ms != null ? ` · sim ${fmtSim(e.sim_time_ms)}` : ''}</span>
                <span>{e.source_id}</span>
                <span>execution {e.execution_id}</span>
                <span>collector {e.collector}</span>
                <span>status {e.collection_status}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  )
}

const TL_ICON: Record<string, { icon: typeof CircleDot; cls: string }> = {
  investigation_opened: { icon: FileSearch, cls: 'bg-[#f1eff3] text-[#4a4752]' },
  baseline_captured: { icon: ShieldCheck, cls: 'bg-[#f1eff3] text-[#4a4752]' },
  fault_injected: { icon: FlaskConical, cls: 'bg-crit-soft text-crit' },
  alarm: { icon: BellRing, cls: 'bg-warn-soft text-warn' },
  diagnostic: { icon: Stethoscope, cls: 'bg-accent-soft text-accent-strong' },
  diagnosis_recorded: { icon: ClipboardCheck, cls: 'bg-nav text-white' },
  repair_applied: { icon: Wrench, cls: 'bg-warn-soft text-warn' },
  verification_passed: { icon: CheckCircle2, cls: 'bg-ok-soft text-ok' },
  verification_failed: { icon: XCircle, cls: 'bg-crit-soft text-crit' },
  resolved: { icon: CheckCircle2, cls: 'bg-ok text-white' },
  abandoned: { icon: AlertOctagon, cls: 'bg-unknown-soft text-unknown' },
  simulation_reset: { icon: RotateCcw, cls: 'bg-unknown-soft text-unknown' },
}

export function Timeline({ events, simulated }: { events: TimelineEvent[]; simulated: boolean }) {
  if (!events.length) return <EmptyState title="No events yet" />
  return (
    <ol className="relative space-y-0 pl-1">
      {events.map((t, i) => {
        const meta = TL_ICON[t.kind] ?? { icon: CircleDot, cls: 'bg-canvas text-muted' }
        const Icon = meta.icon
        return (
          <motion.li key={t.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.025 }} className="relative flex gap-3 pb-3">
            {i < events.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-line" aria-hidden />}
            <span className={clsx('relative z-10 grid size-[27px] shrink-0 place-items-center rounded-full', meta.cls)}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[12.5px] leading-snug text-ink">{t.message}</p>
              <p className="font-mono text-[10.5px] text-faint">
                {fmtTime(t.at)}
                {simulated && t.sim_time_ms != null && ` · sim ${fmtSim(t.sim_time_ms)}`}
              </p>
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}

export function VerificationRunCard({ run, evidence, animate = true }: { run: VerificationRun; evidence?: Evidence[]; animate?: boolean }) {
  const byId = Object.fromEntries((evidence ?? []).map((e) => [e.id, e]))
  return (
    <div className={clsx('overflow-hidden rounded-xl border', run.passed ? 'border-[#c6dfd0]' : 'border-[#ecc5ca]')}>
      <div className={clsx('flex items-center justify-between px-3 py-2', run.passed ? 'bg-ok-soft' : 'bg-crit-soft')}>
        <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: run.passed ? '#18794E' : '#C93644' }}>
          {run.passed ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
          {run.id} — {run.passed ? 'All checks passed' : `${run.checks.filter((c) => !c.passed).length} of ${run.checks.length} checks failed`}
        </div>
        <Mono className="text-[10.5px] text-muted">{fmtTime(run.completed_at)}</Mono>
      </div>
      <ul className="divide-y divide-line-2 bg-white">
        {run.checks.map((c, i) => (
          <motion.li key={c.id} initial={animate ? { opacity: 0, x: -8 } : false} animate={{ opacity: 1, x: 0 }} transition={{ delay: animate ? 0.12 + i * 0.18 : 0, duration: 0.3 }} className="flex gap-3 px-3 py-2.5">
            <motion.span initial={animate ? { scale: 0 } : false} animate={{ scale: 1 }} transition={{ delay: animate ? 0.2 + i * 0.18 : 0, type: 'spring', stiffness: 500, damping: 22 }} className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white', c.passed ? 'bg-ok' : 'bg-crit')} aria-hidden>
              {c.passed ? <svg viewBox="0 0 16 16" className="size-3"><motion.path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={animate ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={{ delay: animate ? 0.3 + i * 0.18 : 0, duration: 0.3 }} /></svg> : <XCircle className="size-3.5" />}
            </motion.span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13px] font-semibold text-ink">{c.label}</span>
                <span className="sr-only">{c.passed ? 'passed' : 'failed'}</span>
                <span className="text-[11.5px] text-muted">{c.rationale}</span>
              </div>
              <p className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-ink/80">{c.detail}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {c.evidence_ids.map((id) => (
                  <span key={id} title={byId[id]?.title} className="rounded bg-canvas px-1 font-mono text-[10px] text-muted">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}
