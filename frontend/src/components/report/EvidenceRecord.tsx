import { VerdictBadge } from '../ui'
import { fmtSim, fmtTime } from '../../lib/format'
import type { Evidence } from '../../lib/types'
import { Chips, CodeBlock, Field, FieldGrid, humanize, kvText } from './primitives'

export function EvidenceRecord({ ev }: { ev: Evidence }) {
  const sim = ev.source_mode === 'SIMULATED'
  return (
    <article id={ev.id} className="rpt-ev scroll-mt-24 space-y-4 rounded-sm border-t border-line-2 pt-5 first:border-t-0 first:pt-0">
      <header className="rpt-avoid">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px]">
            <span className="font-mono font-medium text-ink">{ev.id}</span>
            <span className="text-muted">{humanize(ev.phase)}</span>
          </div>
          <VerdictBadge verdict={ev.verdict} />
        </div>
        <h4 className="mt-1 break-words text-[14.5px] font-semibold leading-snug text-ink">{ev.title}</h4>
        {ev.purpose && <p className="mt-0.5 text-[13px] text-muted">{ev.purpose}</p>}
      </header>

      <FieldGrid className="grid-cols-2 md:grid-cols-3">
        <Field label="Source mode" mono>
          {ev.source_mode}
        </Field>
        <Field label="Source ID" mono>
          {ev.source_id}
        </Field>
        <Field label="Collector" mono>
          {ev.collector}
        </Field>
        <Field label="Collected (UTC, wall clock)" mono>
          {fmtTime(ev.collected_at, true)}
        </Field>
        <Field label="Simulated time" mono>
          {ev.sim_time_ms == null ? 'N/A' : `${fmtSim(ev.sim_time_ms)} (${ev.sim_time_ms.toLocaleString('en-US')} ms)`}
        </Field>
        <Field label="Collection status" mono>
          {ev.collection_status}
        </Field>
        <Field label="Target">
          <Chips items={kvText(ev.target)} />
        </Field>
        <Field label="Parameters" wide>
          <Chips items={kvText(ev.params)} />
        </Field>
      </FieldGrid>

      {ev.command && (
        <div className="rpt-raw flex min-w-0 gap-2 rounded-md border border-line bg-stage px-3 py-2 font-mono text-[12px] leading-relaxed">
          <span className="select-none text-faint" aria-hidden>
            $
          </span>
          <code className="min-w-0 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
            <span className="sr-only">Command: </span>
            {ev.command}
          </code>
        </div>
      )}

      <div className="rpt-avoid">
        <div className="text-[12px] text-muted">Interpretation</div>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink">{ev.interpretation || '—'}</p>
      </div>

      {ev.limitations.length > 0 && (
        <div className="rpt-avoid">
          <div className="text-[12px] text-muted">Limitations</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed text-muted marker:text-faint">
            {ev.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      <CodeBlock label="Raw output" text={ev.raw_output} simulated={sim} />

      <div className="flex min-w-0 gap-2 text-[11.5px]">
        <span className="shrink-0 text-muted">SHA-256</span>
        <span className="min-w-0 break-all font-mono text-ink">{ev.content_sha256}</span>
      </div>
    </article>
  )
}
