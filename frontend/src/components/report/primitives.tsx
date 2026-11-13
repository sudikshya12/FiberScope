import type { ReactNode } from 'react'
import clsx from 'clsx'
import { CopyButton } from '../ui'
import type { Evidence, Hypothesis, InvStatus, Investigation, Metrics, Repair, SourceMode, TimelineEvent, TracedPath, Verdict, VerificationRun } from '../../lib/types'

// ---------------------------------------------------------------- report JSON shape (fiberscope.report.v1)

export interface EvidenceSummary {
  id: string
  title: string
  collector: string
  phase: Evidence['phase']
  verdict: Verdict
  collected_at: string
  sim_time_ms: number | null
  source_mode: SourceMode
  interpretation: string
  command: string
}

export interface ReportData {
  report_version: string
  generated_at: string
  title: string
  investigation: { id: string; status: InvStatus; mode: 'guided' | 'challenge'; created_at: string; resolved_at: string | null; abandoned_at: string | null; failed_verifications: number }
  scenario: { key: string; version: number; title: string; short: string; source_mode: SourceMode; execution_id: string }
  network_path: { source: string; path: TracedPath | null }
  initial_symptom: string
  scope: string
  baseline: EvidenceSummary[]
  diagnostic_actions: EvidenceSummary[]
  evidence: Evidence[]
  hypotheses: Hypothesis[]
  diagnosis: null | { category: string; category_label: string; statement: string; recorded_at: string; cited_evidence: { id: string; title: string; verdict: Verdict }[] }
  corrective_actions: Repair[]
  verification: VerificationRun[]
  timeline: TimelineEvent[]
  metrics: Metrics
  limitations: string[]
  lessons_learned: string
  answer_key: Investigation['answer_key']
  resolution_criteria: { id: string; label: string; met: boolean }[]
  provenance: { evidence_count: number; source_modes: string[]; integrity: string }
}

// ---------------------------------------------------------------- helpers

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function kvText(obj: Record<string, unknown> | null | undefined): string[] {
  return Object.entries(obj ?? {}).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
}

/** Wall-clock seconds with sub-second precision (operator actions via the API can be very fast). */
export function fmtSecs(s: number | string | null | undefined): string {
  if (s == null || s === '') return '—'
  const n = Number(s)
  if (Number.isNaN(n)) return String(s)
  if (n < 10) return `${n.toFixed(1)} s`
  if (n < 60) return `${n.toFixed(0)} s`
  if (n < 3600) return `${Math.floor(n / 60)} min ${Math.round(n % 60)} s`
  return `${Math.floor(n / 3600)} h ${Math.round((n % 3600) / 60)} min`
}

export function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.add('rpt-flash')
  window.setTimeout(() => el.classList.remove('rpt-flash'), 1400)
}

// ---------------------------------------------------------------- building blocks

/**
 * A report part — Summary, Observations, Diagnosis, Repair, Verification, Record. On wide screens the
 * part name sits in a graphite left column; on phones and in print it becomes a heading above.
 */
export function Part({ label, range, children, breakBefore }: { label: string; range: string; children: ReactNode; breakBefore?: boolean }) {
  return (
    <div className={clsx('rpt-part grid gap-x-10 gap-y-5 border-t border-ink pt-4 md:grid-cols-[112px_minmax(0,1fr)]', breakBefore && 'print-break')}>
      <div className="rpt-part-label rpt-h">
        <div className="flex items-baseline gap-2 md:sticky md:top-20 md:block">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-ink">{label}</div>
          <div className="tnum font-mono text-[11px] text-faint md:mt-0.5">{range}</div>
        </div>
      </div>
      <div className="min-w-0 divide-y divide-line-2 [&>*+*]:pt-8 [&>*:not(:last-child)]:pb-8">{children}</div>
    </div>
  )
}

export function Section({ n, title, children, breakBefore, aside }: { n: number; title: string; children: ReactNode; breakBefore?: boolean; aside?: ReactNode }) {
  const hid = `rpt-sec-${n}`
  return (
    <section aria-labelledby={hid} className={clsx('rpt-section min-w-0 scroll-mt-20', breakBefore && 'print-break')}>
      <div className="rpt-h flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={hid} className="flex items-baseline gap-2.5 text-[17px] font-semibold tracking-tight text-ink">
          <span className="tnum font-mono text-[12px] font-medium text-faint">{String(n).padStart(2, '0')}</span>
          {title}
        </h2>
        {aside && <div className="text-[12.5px] text-muted">{aside}</div>}
      </div>
      <div className="mt-4 space-y-5 text-[14px] leading-relaxed text-ink">{children}</div>
    </section>
  )
}

export function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="rpt-h text-[12.5px] font-semibold text-ink">{children}</h3>
}

export function Field({ label, children, mono, wide }: { label: ReactNode; children: ReactNode; mono?: boolean; wide?: boolean }) {
  return (
    <div className={clsx('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={clsx('mt-0.5 min-w-0 break-words text-ink', mono ? 'font-mono text-[12.5px]' : 'text-[13.5px]')}>{children ?? '—'}</dd>
    </div>
  )
}

export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={clsx('grid gap-x-8 gap-y-3 sm:grid-cols-2', className)}>{children}</dl>
}

/** A cited evidence ID that scrolls to the evidence record inside the report. */
export function EvRef({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault()
        scrollToId(id)
      }}
      className="rpt-evref inline-flex items-center rounded px-0.5 font-mono text-[12px] font-medium text-accent-strong underline decoration-accent/30 underline-offset-2 transition-colors hover:bg-accent-soft hover:decoration-accent"
    >
      {id}
    </a>
  )
}

export function EvRefs({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="text-muted">—</span>
  return (
    <span className="inline-flex flex-wrap gap-x-1.5 gap-y-0.5">
      {ids.map((i) => (
        <EvRef key={i} id={i} />
      ))}
    </span>
  )
}

export function Placeholder({ children }: { children: ReactNode }) {
  return <p className="rpt-placeholder text-[13.5px] italic text-muted">{children}</p>
}

export function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-4 text-[14.5px] leading-relaxed text-ink">{children}</blockquote>
}

export function Chips({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-muted">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((t) => (
        <code key={t} className="max-w-full break-all rounded bg-canvas px-1.5 py-px font-mono text-[11.5px] text-ink">
          {t}
        </code>
      ))}
    </span>
  )
}

/** Monospace command / raw-output block. Wide lines scroll inside the block, never the page; print wraps. */
export function CodeBlock({ text, label, simulated, dark = true }: { text: string; label: string; simulated?: boolean; dark?: boolean }) {
  return (
    <div className={clsx('rpt-raw min-w-0 overflow-hidden rounded-md border', dark ? 'border-[#2c2a31] bg-[#1d1c21]' : 'border-line bg-stage')}>
      <div className={clsx('rpt-raw-head flex items-center justify-between gap-2 border-b px-3 py-1', dark ? 'border-white/[0.06]' : 'border-line-2')}>
        <span className={clsx('font-mono text-[10.5px] uppercase tracking-wider', dark ? 'text-[#a29eab]' : 'text-muted')}>
          {label}
          {simulated && <span className={clsx('ml-2 rounded px-1', dark ? 'bg-white/10 text-[#d8d5de]' : 'bg-unknown-soft text-muted')}>simulated</span>}
        </span>
        <span className="no-print">
          <CopyButton text={text} />
        </span>
      </div>
      <pre className={clsx('rpt-pre scroll-thin max-h-[22rem] overflow-auto px-3 py-2.5 text-[11.5px] leading-[1.6]', dark ? 'text-[#e4e1e8]' : 'text-ink')}>{text || '(no output)'}</pre>
    </div>
  )
}

// ---------------------------------------------------------------- print + document styles

/**
 * Report-scoped document & print CSS. The app shell is a fixed-height flex layout with an inner scroll
 * container, which would clip the printout to one page — so print mode unwinds it to normal flow.
 */
export const REPORT_CSS = `
.rpt-flash { animation: rpt-flash 1.4s ease-out; }
@keyframes rpt-flash { 0% { box-shadow: 0 0 0 3px rgb(105 65 198 / 0.30); } 100% { box-shadow: 0 0 0 3px rgb(105 65 198 / 0); } }
@media print {
  @page { size: A4; margin: 15mm 14mm 16mm; }
  html, body, #root { height: auto !important; overflow: visible !important; background: #fff !important; }
  .h-dvh, .h-dvh > div, main#main, main#main > div { display: block !important; height: auto !important; min-height: 0 !important; overflow: visible !important; transform: none !important; opacity: 1 !important; }
  .rpt-canvas { background: #fff !important; padding: 0 !important; }
  .rpt-sheet { max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
  .rpt-sheet { color: #000 !important; }
  .rpt-sheet .text-ink { color: #000 !important; }
  .rpt-sheet .text-muted, .rpt-sheet .text-faint, .rpt-placeholder { color: #444 !important; }
  .rpt-part { display: block !important; border-color: #000 !important; }
  .rpt-part-label { margin-bottom: 4mm; }
  .rpt-part-label > div { position: static !important; display: flex !important; gap: 8px; align-items: baseline; }
  .rpt-raw { background: #fff !important; border: 1px solid #999 !important; }
  .rpt-raw-head { border-color: #ccc !important; }
  .rpt-raw-head span, .rpt-pre { color: #000 !important; }
  .rpt-pre { max-height: none !important; overflow: visible !important; white-space: pre-wrap !important; word-break: break-word; font-size: 9pt !important; }
  .rpt-h { break-after: avoid; }
  .rpt-avoid { break-inside: avoid; }
  .rpt-evref { color: #000 !important; text-decoration: none !important; }
  tr, li { break-inside: avoid; }
  a { text-decoration: none; }
}
`
