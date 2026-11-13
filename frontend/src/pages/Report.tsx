import { useEffect, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, CheckCircle2, CircleDashed, FileJson, FileSpreadsheet, FileX2, KeyRound, Printer, XCircle } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { fmtSim, fmtTime } from '../lib/format'
import type { Evidence, VerificationRun } from '../lib/types'
import { Badge, Button, EmptyState, ErrorState, Skeleton, SourceBadge, StatusPill, VerdictBadge } from '../components/ui'
import { AnchorButton, LinkButton } from '../components/report/LinkButton'
import { Chips, CodeBlock, EvRef, EvRefs, Field, FieldGrid, Part, Placeholder, Quote, REPORT_CSS, Section, SubHead, kvText, type EvidenceSummary, type ReportData } from '../components/report/primitives'
import { EvidenceRecord } from '../components/report/EvidenceRecord'
import { NetworkPath } from '../components/report/NetworkPath'
import { TimeMetrics, TimelineList } from '../components/report/Timeline'

export default function Report() {
  const { id = '' } = useParams()
  const q = useQuery<ReportData>({
    queryKey: ['report', id],
    queryFn: () => api.report(id),
    enabled: !!id,
    retry: (n, err) => !(err instanceof ApiError && err.status === 404) && n < 2,
  })

  useEffect(() => {
    if (!q.data) return
    const prev = document.title
    document.title = `${q.data.investigation.id} — ${q.data.title} · FiberScope report`
    return () => {
      document.title = prev
    }
  }, [q.data])

  return (
    <div className="rpt-canvas min-h-full bg-canvas px-4 pb-16 md:px-8">
      <style>{REPORT_CSS}</style>
      <Toolbar id={id} ready={!!q.data} />
      {q.isPending ? (
        <SheetSkeleton />
      ) : q.isError ? (
        q.error instanceof ApiError && q.error.status === 404 ? (
          <Sheet>
            <EmptyState icon={<FileX2 className="size-5" />} title="Report not found" action={<LinkButton to="/investigations">Browse investigations</LinkButton>}>
              No investigation with ID <span className="font-mono text-ink">{id}</span> exists, so no report can be generated.
            </EmptyState>
          </Sheet>
        ) : (
          <Sheet>
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </Sheet>
        )
      ) : (
        <ReportDocument r={q.data} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- chrome

function Toolbar({ id, ready }: { id: string; ready: boolean }) {
  return (
    <div className="no-print sticky top-0 z-20 -mx-4 mb-6 border-b border-line bg-canvas px-4 py-2.5 md:-mx-8 md:px-8">
      <div className="mx-auto flex max-w-[980px] flex-wrap items-center justify-between gap-2">
        <LinkButton to={ready ? `/investigations/${id}` : '/investigations'} variant="ghost" size="sm" icon={<ArrowLeft className="size-4" aria-hidden />} className="-ml-2.5">
          {ready ? 'Back to investigation' : 'All investigations'}
        </LinkButton>
        <div className="flex flex-wrap items-center gap-2">
          <AnchorButton href={`/api/reports/${encodeURIComponent(id)}/measurements.csv`} download size="sm" icon={<FileSpreadsheet className="size-4 text-muted" aria-hidden />} aria-disabled={!ready} className={clsx(!ready && 'pointer-events-none opacity-50')}>
            <span>
              CSV<span className="hidden sm:inline"> measurements</span>
            </span>
          </AnchorButton>
          <AnchorButton href={`/api/reports/${encodeURIComponent(id)}/export.json`} download={`fiberscope-${id}-report.json`} size="sm" icon={<FileJson className="size-4 text-muted" aria-hidden />} aria-disabled={!ready} className={clsx(!ready && 'pointer-events-none opacity-50')}>
            <span>
              JSON<span className="hidden sm:inline"> export</span>
            </span>
          </AnchorButton>
          <Button variant="primary" size="sm" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()} disabled={!ready}>
            Print
          </Button>
        </div>
      </div>
    </div>
  )
}

const SHEET = 'rpt-sheet mx-auto w-full max-w-[980px] rounded-lg border border-line bg-white px-5 py-8 sm:px-10 md:px-14 md:py-12'

function Sheet({ children }: { children: ReactNode }) {
  return <article className={SHEET}>{children}</article>
}

function SheetSkeleton() {
  return (
    <div className={SHEET} role="status" aria-live="polite">
      <span className="sr-only">Generating report…</span>
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-6 h-8 w-3/4" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="mt-10 space-y-2.5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------- document

function ReportDocument({ r }: { r: ReportData }) {
  const inv = r.investigation
  const mode = r.scenario.source_mode
  const counts = r.metrics.counts
  const phases: { key: Evidence['phase']; label: string }[] = [
    { key: 'baseline', label: 'Baseline' },
    { key: 'investigation', label: 'Investigation' },
    { key: 'repair', label: 'Corrective action' },
    { key: 'verification', label: 'Verification' },
  ]
  return (
    <Sheet>
      {/* Letterhead */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[12px]">
        <span>
          <span className="font-semibold text-ink">FiberScope</span>
          <span className="text-muted"> · Investigation report</span>
        </span>
        <span className="font-mono text-[11px] text-faint">{r.report_version}</span>
      </div>

      <header className="mt-8 mb-10">
        <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-tight text-ink md:text-[30px]">{r.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
          <span className="font-mono text-[13px] font-medium text-ink">{inv.id}</span>
          <StatusPill status={inv.status} />
          <span className="text-muted">{inv.mode === 'challenge' ? 'Challenge' : 'Guided'} mode</span>
        </div>
        <p className="tnum mt-2 text-[13px] text-muted">
          {plural(counts.diagnostic_actions, 'diagnostic action')} · {plural(counts.repairs, 'corrective action')} ·{' '}
          <span className={clsx(counts.failed_verifications > 0 && 'font-medium text-crit')}>{plural(counts.failed_verifications, 'failed verification')}</span> · {plural(r.provenance.evidence_count, 'evidence item')}
          {counts.reopened > 0 && ` · reopened ${plural(counts.reopened, 'time')}`}
        </p>
      </header>

      <div className="space-y-12">
        <Part label="Summary" range="01–04">
          {/* 1 */}
          <Section n={1} title="Investigation">
            <FieldGrid className="sm:grid-cols-3">
              <Field label="Opened (UTC)" mono>
                {fmtTime(inv.created_at, true)}
              </Field>
              <Field label={inv.abandoned_at ? 'Abandoned (UTC)' : 'Resolved (UTC)'} mono>
                {inv.abandoned_at ? fmtTime(inv.abandoned_at, true) : inv.resolved_at ? fmtTime(inv.resolved_at, true) : 'Not resolved'}
              </Field>
              <Field label="Report generated (UTC)" mono>
                {fmtTime(r.generated_at, true)}
              </Field>
            </FieldGrid>
          </Section>

          {/* 2 */}
          <Section n={2} title="Scenario and source mode">
            <SourceNote mode={mode} />
            <FieldGrid>
              <Field label="Scenario">{r.scenario.title}</Field>
              <Field label="Scenario key" mono>
                {r.scenario.key}@{r.scenario.version}
              </Field>
              <Field label="Summary">{r.scenario.short}</Field>
              <Field label="Execution ID" mono>
                {r.scenario.execution_id}
              </Field>
              <Field label="Source modes present in evidence" mono>
                {r.provenance.source_modes.length ? r.provenance.source_modes.join(', ') : '—'}
              </Field>
            </FieldGrid>
          </Section>

          {/* 3 */}
          <Section n={3} title="Network path">
            <NetworkPath path={r.network_path.path} source={r.network_path.source} />
          </Section>

          {/* 4 */}
          <Section n={4} title="Initial symptom">
            {r.initial_symptom ? <Quote>{r.initial_symptom}</Quote> : <Placeholder>No initial symptom recorded by the operator.</Placeholder>}
            <div>
              <SubHead>Scope</SubHead>
              <div className="mt-1">{r.scope ? <p className="whitespace-pre-wrap text-[14px]">{r.scope}</p> : <Placeholder>No scope recorded by the operator.</Placeholder>}</div>
            </div>
          </Section>
        </Part>

        <Part label="Observations" range="05–07">
          {/* 5 */}
          <Section n={5} title="Baseline" aside={plural(r.baseline.length, 'observation')}>
            {r.baseline.length ? (
              <ul className="divide-y divide-line-2 border-t border-line-2">
                {r.baseline.map((b) => (
                  <SummaryRow key={b.id} s={b} />
                ))}
              </ul>
            ) : (
              <Placeholder>No healthy baseline was captured before the fault.</Placeholder>
            )}
          </Section>

          {/* 6 */}
          <Section n={6} title="Diagnostic actions" aside={plural(r.diagnostic_actions.length, 'action')}>
            {r.diagnostic_actions.length ? <ActionsTable rows={r.diagnostic_actions} /> : <Placeholder>No diagnostic actions were run during the investigation phase.</Placeholder>}
          </Section>

          {/* 7 */}
          <Section n={7} title="Evidence" breakBefore aside={`${plural(r.evidence.length, 'item')} · append-only`}>
            <p className="text-[13px] text-muted">{r.provenance.integrity}</p>
            {phases.map(({ key, label }) => {
              const items = r.evidence.filter((e) => e.phase === key)
              if (!items.length) return null
              return (
                <div key={key} className="space-y-5 pt-3">
                  <SubHead>
                    {label} <span className="font-normal text-muted">· {items.length}</span>
                  </SubHead>
                  <div className="space-y-5">
                    {items.map((e) => (
                      <EvidenceRecord key={e.id} ev={e} />
                    ))}
                  </div>
                </div>
              )
            })}
            {!r.evidence.length && <Placeholder>No evidence was collected.</Placeholder>}
          </Section>
        </Part>

        <Part label="Diagnosis" range="08" breakBefore>
          {/* 8 */}
          <Section n={8} title="Diagnosis">
            {r.diagnosis ? (
              <>
                <FieldGrid>
                  <Field label="Category">
                    {r.diagnosis.category_label || r.diagnosis.category} <span className="font-mono text-[12px] text-muted">({r.diagnosis.category})</span>
                  </Field>
                  <Field label="Recorded (UTC)" mono>
                    {fmtTime(r.diagnosis.recorded_at, true)}
                  </Field>
                </FieldGrid>
                <Quote>{r.diagnosis.statement}</Quote>
                <div>
                  <SubHead>Cited evidence</SubHead>
                  <ul className="mt-2 divide-y divide-line-2 border-t border-line-2">
                    {r.diagnosis.cited_evidence.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                        <span className="w-[84px] shrink-0">
                          <EvRef id={c.id} />
                        </span>
                        <span className="min-w-0 flex-1 text-[13.5px]">{c.title}</span>
                        <VerdictBadge verdict={c.verdict} />
                      </li>
                    ))}
                    {!r.diagnosis.cited_evidence.length && <li className="py-2 text-muted">No evidence cited.</li>}
                  </ul>
                </div>
              </>
            ) : (
              <Placeholder>No diagnosis has been recorded for this investigation.</Placeholder>
            )}
            {r.hypotheses.length > 0 && (
              <div>
                <SubHead>Hypotheses considered</SubHead>
                <ul className="mt-2 divide-y divide-line-2 border-t border-line-2">
                  {r.hypotheses.map((h) => (
                    <li key={h.id} className="rpt-avoid py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] text-muted">{h.id}</span>
                        <Badge tone={h.status === 'confirmed' || h.status === 'supported' ? 'ok' : h.status === 'refuted' ? 'crit' : 'neutral'} className="uppercase">
                          {h.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[13.5px]">{h.statement}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted">
                        <span className="flex flex-wrap items-center gap-1.5">
                          Supporting <EvRefs ids={h.supporting_evidence_ids} />
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          Contradicting <EvRefs ids={h.contradicting_evidence_ids} />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.answer_key && <AnswerKey k={r.answer_key} />}
          </Section>
        </Part>

        <Part label="Repair" range="09">
          {/* 9 */}
          <Section n={9} title="Corrective action" aside={r.corrective_actions.length > 1 ? plural(r.corrective_actions.length, 'action') : undefined}>
            {r.corrective_actions.length ? (
              <div className="divide-y divide-line-2 [&>*+*]:pt-5 [&>*:not(:last-child)]:pb-5">
                {r.corrective_actions.map((a) => (
                  <div key={a.id} className="rpt-avoid space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-[12px] text-muted">{a.id}</span>
                        <div className="text-[14.5px] font-semibold text-ink">{a.description}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={a.outcome === 'state_changed' ? 'ok' : 'neutral'}>{a.outcome.replace(/_/g, ' ')}</Badge>
                        {a.source_mode !== mode && <SourceBadge mode={a.source_mode} />}
                      </div>
                    </div>
                    <FieldGrid className="sm:grid-cols-3">
                      <Field label="Action" mono>
                        {a.action}
                      </Field>
                      <Field label="Applied (UTC, wall clock)" mono>
                        {fmtTime(a.applied_at, true)}
                      </Field>
                      <Field label="Simulated time" mono>
                        {fmtSim(a.sim_time_ms)}
                      </Field>
                      <Field label="Target">
                        <Chips items={kvText(a.target)} />
                      </Field>
                      <Field label="Parameters">
                        <Chips items={kvText(a.params)} />
                      </Field>
                      <Field label="Changed resources">
                        <Chips items={a.changed_resources} />
                      </Field>
                      {a.evidence_id && (
                        <Field label="Evidence">
                          <EvRef id={a.evidence_id} />
                        </Field>
                      )}
                      {a.notes && (
                        <Field label="Operator notes" wide>
                          {a.notes}
                        </Field>
                      )}
                    </FieldGrid>
                    {a.command && <CodeBlock dark={false} label="Change applied" text={a.command} simulated={a.source_mode === 'SIMULATED'} />}
                  </div>
                ))}
              </div>
            ) : (
              <Placeholder>No corrective action has been applied.</Placeholder>
            )}
          </Section>
        </Part>

        <Part label="Verification" range="10">
          {/* 10 */}
          <Section n={10} title="Verification" aside={r.verification.length ? plural(r.verification.length, 'run') : undefined}>
            {r.verification.length ? r.verification.map((v, i) => <VerificationBlock key={v.id} v={v} n={i + 1} />) : <Placeholder>No verification has been run.</Placeholder>}
            {r.resolution_criteria.length > 0 && (
              <div className="rpt-avoid">
                <SubHead>Resolution criteria</SubHead>
                <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {r.resolution_criteria.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-[13.5px]">
                      {c.met ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Met" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-faint" aria-label="Not met" />}
                      <span className={c.met ? 'text-ink' : 'text-muted'}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </Part>

        <Part label="Record" range="11–13" breakBefore>
          {/* 11 */}
          <Section n={11} title="Timeline" aside={plural(r.timeline.length, 'audit event')}>
            <TimeMetrics metrics={r.metrics} />
            <div className="pt-2">
              <SubHead>Audit events</SubHead>
              <div className="mt-3">
                <TimelineList events={r.timeline} />
              </div>
            </div>
          </Section>

          {/* 12 */}
          <Section n={12} title="Limitations">
            {r.limitations.length ? (
              <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed marker:font-mono marker:text-[11.5px] marker:text-faint">
                {r.limitations.map((l) => (
                  <li key={l} className="pl-1">
                    {l}
                  </li>
                ))}
              </ol>
            ) : (
              <Placeholder>No limitations recorded.</Placeholder>
            )}
          </Section>

          {/* 13 */}
          <Section n={13} title="Lessons learned">
            {r.lessons_learned.trim() ? <Quote>{r.lessons_learned}</Quote> : <Placeholder>No lessons recorded by the operator.</Placeholder>}
          </Section>
        </Part>
      </div>

      <footer className="rpt-avoid mt-12 border-t border-ink pt-4 text-[11.5px] leading-relaxed text-muted">
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
          <span>
            <span className="font-mono">{r.report_version}</span> · generated {fmtTime(r.generated_at, true)} from stored records only
          </span>
          <span className="font-mono">
            {inv.id} · {r.scenario.execution_id} · {r.provenance.evidence_count} evidence items
          </span>
        </div>
        <div className="mt-1">Source mode: {mode}. End of report.</div>
      </footer>
    </Sheet>
  )
}

// ---------------------------------------------------------------- pieces

function SourceNote({ mode }: { mode: string }) {
  const text =
    mode === 'SIMULATED'
      ? 'Every device output, measurement and state change in this report was generated by FiberScope’s deterministic simulation model. Nothing was captured from real switches, servers, optics or fiber.'
      : mode === 'LINUX_LAB'
        ? 'Evidence was collected from isolated Linux network namespaces and veth pairs. Virtual Ethernet does not exercise physical optics or fiber.'
        : 'Evidence was imported from an external source. It is untrusted and was validated for type and range only.'
  return (
    <div className="rpt-avoid border-l-2 border-ink pl-4" role="note">
      <div className="font-mono text-[13px] font-semibold tracking-[0.08em] text-ink">{mode.replace(/_/g, ' ')}</div>
      <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink">{text}</p>
    </div>
  )
}

function SummaryRow({ s }: { s: EvidenceSummary }) {
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-5">
      <div className="flex shrink-0 items-center gap-2 sm:w-[104px] sm:flex-col sm:items-start sm:gap-1">
        <EvRef id={s.id} />
        <VerdictBadge verdict={s.verdict} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink">{s.title}</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{s.interpretation}</p>
      </div>
    </li>
  )
}

function ActionsTable({ rows }: { rows: EvidenceSummary[] }) {
  return (
    <>
      {/* stacked on phones */}
      <ul className="divide-y divide-line-2 border-t border-line-2 sm:hidden">
        {rows.map((a) => (
          <li key={a.id} className="space-y-1 py-3">
            <div className="flex items-center justify-between gap-2">
              <EvRef id={a.id} />
              <VerdictBadge verdict={a.verdict} />
            </div>
            <div className="text-[13.5px] font-medium">{a.title}</div>
            <div className="tnum font-mono text-[11.5px] text-muted">
              {fmtTime(a.collected_at)} · sim {fmtSim(a.sim_time_ms)} · {a.collector}
            </div>
            <code className="block whitespace-pre-wrap font-mono text-[11.5px] text-ink [overflow-wrap:anywhere]">{a.command}</code>
          </li>
        ))}
      </ul>
      <table className="hidden w-full table-fixed border-collapse text-left text-[12.5px] sm:table">
        <caption className="sr-only">Diagnostic actions in the order they were run</caption>
        <colgroup>
          <col className="w-[84px]" />
          <col className="w-[76px]" />
          <col className="w-[64px]" />
          <col className="w-[136px]" />
          <col className="w-[80px]" />
          <col />
        </colgroup>
        <thead className="text-[12px] text-muted">
          <tr className="border-y border-line">
            <th scope="col" className="py-2 pr-3 font-medium">
              Evidence
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              UTC
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Sim
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Collector
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Verdict
            </th>
            <th scope="col" className="py-2 pl-3 font-medium">
              Command
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-line-2 align-top last:border-b-0">
              <td className="py-2.5 pr-3">
                <EvRef id={a.id} />
              </td>
              <td className="tnum px-3 py-2.5 font-mono text-[11.5px] text-muted">{fmtTime(a.collected_at).replace(' UTC', '')}</td>
              <td className="tnum px-3 py-2.5 font-mono text-[11.5px] text-muted">{fmtSim(a.sim_time_ms)}</td>
              <td className="break-words px-3 py-2.5 font-mono text-[11.5px]">{a.collector}</td>
              <td className="px-3 py-2.5">
                <VerdictBadge verdict={a.verdict} />
              </td>
              <td className="py-2.5 pl-3">
                <code className="block whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-ink [overflow-wrap:anywhere]">{a.command}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function VerificationBlock({ v, n }: { v: VerificationRun; n: number }) {
  const passed = v.checks.filter((c) => c.passed).length
  return (
    <div className="rpt-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-2">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
          <span className="font-semibold text-ink">Run {n}</span>
          <span className="font-mono text-[12px] text-muted">{v.id}</span>
          <span className={clsx('inline-flex items-center gap-1 self-center text-[12.5px] font-semibold', v.passed ? 'text-ok' : 'text-crit')}>
            {v.passed ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
            {v.passed ? 'Passed' : 'Failed'}
          </span>
        </div>
        <span className="tnum font-mono text-[11.5px] text-muted">
          {fmtTime(v.started_at, true)} · {passed}/{v.checks.length} checks
        </span>
      </div>
      <ul className="divide-y divide-line-2">
        {v.checks.map((c) => (
          <li key={c.id} className="grid grid-cols-[16px_1fr] gap-x-3 py-3">
            {c.passed ? <CheckCircle2 className="mt-1 size-4 text-ok" aria-hidden /> : <XCircle className="mt-1 size-4 text-crit" aria-hidden />}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-[13.5px] font-semibold text-ink">{c.label}</span>
                <span className={clsx('text-[11.5px] font-semibold tracking-wide', c.passed ? 'text-ok' : 'text-crit')}>{c.passed ? 'PASS' : 'FAIL'}</span>
              </div>
              <p className="text-[13px] text-muted">{c.rationale}</p>
              <p className="mt-1 break-words font-mono text-[12px] text-ink">{c.detail}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                Evidence <EvRefs ids={c.evidence_ids} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AnswerKey({ k }: { k: NonNullable<ReportData['answer_key']> }) {
  const m = k.diagnosis_matched
  return (
    <div className="rpt-avoid rounded-md border border-dashed border-[#cfc9d6] p-4" role="note" aria-label="Scenario answer key">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <KeyRound className="size-3.5 text-muted" aria-hidden /> Answer key
        </div>
        <span className="text-[12px] text-muted">Shown after resolution or in guided mode</span>
      </div>
      <div className={clsx('mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium', m === true && 'text-ok', m === false && 'text-crit', m == null && 'text-muted')}>
        {m === true ? <CheckCircle2 className="size-4" aria-hidden /> : m === false ? <XCircle className="size-4" aria-hidden /> : <CircleDashed className="size-4" aria-hidden />}
        {m === true ? 'Diagnosis matched the answer key.' : m === false ? 'Diagnosis did not match the answer key.' : 'No diagnosis recorded — nothing to compare.'}
        <span className="font-mono text-[11px] font-normal text-faint">diagnosis_matched = {String(m)}</span>
      </div>
      <FieldGrid className="mt-3">
        <Field label="Expected category">
          {k.diagnosis_label} <span className="font-mono text-[12px] text-muted">({k.diagnosis_category})</span>
        </Field>
        <Field label="Fault">{k.fault_mutation}</Field>
        <Field label="Expected corrective action" wide>
          {k.corrective_action}
        </Field>
      </FieldGrid>
    </div>
  )
}
