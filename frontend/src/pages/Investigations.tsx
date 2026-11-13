import { useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import { Page } from '../components/AppShell'
import { EmptyState, ErrorState, PageHeader, Segmented, Skeleton, StatusPill } from '../components/ui'
import { LinkButton } from '../components/report/LinkButton'
import { useInvestigations } from '../lib/hooks'
import { fmtDate, relTime } from '../lib/format'
import type { InvestigationSummary } from '../lib/types'

type Filter = 'all' | 'active' | 'resolved' | 'abandoned'
const FILTERS: Filter[] = ['all', 'active', 'resolved', 'abandoned']

const isClosed = (s: InvestigationSummary['status']) => s === 'resolved' || s === 'abandoned'
const matches = (f: Filter, s: InvestigationSummary['status']) => (f === 'all' ? true : f === 'active' ? !isClosed(s) : s === f)

/** The latest lifecycle timestamp the summary actually carries — labelled with what it is. */
function milestone(i: InvestigationSummary): { label: string; at: string } {
  if (i.resolved_at) return { label: 'Resolved', at: i.resolved_at }
  if (i.abandoned_at) return { label: 'Abandoned', at: i.abandoned_at }
  return { label: 'Opened', at: i.created_at }
}

export default function Investigations() {
  const q = useInvestigations()
  const [filter, setFilter] = useState<Filter>('all')
  const all = useMemo(() => q.data?.investigations ?? [], [q.data])
  const rows = useMemo(() => all.filter((i) => matches(filter, i.status)), [all, filter])
  const count = (f: Filter) => all.filter((i) => matches(f, i.status)).length

  return (
    <Page>
      <PageHeader
        title="Investigations"
        description="Every drill you have opened. Reports are built from the stored evidence only."
        actions={
          <LinkButton to="/scenarios" variant="primary">
            New investigation
          </LinkButton>
        }
      />

      {q.isPending ? (
        <div className="panel divide-y divide-line-2" role="status" aria-live="polite">
          <span className="sr-only">Loading investigations…</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="hidden h-4 w-32 md:block" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : all.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No investigations yet"
            action={
              <LinkButton to="/scenarios" variant="primary">
                Choose a scenario
              </LinkButton>
            }
          >
            Start one from the scenario list. Each investigation records its evidence, diagnosis, repair and verification.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Segmented<Filter>
              label="Status filter"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({
                value: f,
                label: (
                  <span className="flex items-center gap-1.5">
                    {f[0].toUpperCase() + f.slice(1)}
                    <span className="tnum font-mono text-[10.5px] text-faint">{count(f)}</span>
                  </span>
                ),
              }))}
            />
            <span className="text-[12.5px] text-muted" aria-live="polite">
              {rows.length} of {all.length}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="panel">
              <EmptyState title={`No ${filter} investigations`}>Nothing matches this filter.</EmptyState>
            </div>
          ) : (
            <>
              <DesktopTable rows={rows} />
              <MobileList rows={rows} />
            </>
          )}
        </>
      )}
    </Page>
  )
}

function ScenarioCell({ i }: { i: InvestigationSummary }) {
  return i.scenario.key === 'undisclosed' ? (
    <span className="inline-flex items-center gap-1 text-muted" title="Hidden until the challenge is resolved or abandoned">
      <Lock className="size-3" aria-hidden /> Undisclosed
    </span>
  ) : (
    <span className="text-ink">{i.scenario.title}</span>
  )
}

function Actions({ i }: { i: InvestigationSummary }) {
  const closed = isClosed(i.status)
  return (
    <div className="inline-flex gap-1.5">
      <LinkButton to={`/investigations/${i.id}`} size="sm" aria-label={`${closed ? 'Open' : 'Resume'} ${i.id}`} className="min-w-[76px]">
        {closed ? 'Open' : 'Resume'}
      </LinkButton>
      <LinkButton to={`/reports/${i.id}`} size="sm" variant="ghost" aria-label={`Report for ${i.id}`}>
        Report
      </LinkButton>
    </div>
  )
}

function When({ i }: { i: InvestigationSummary }) {
  const m = milestone(i)
  return (
    <span title={fmtDate(m.at)}>
      <span className="text-muted">{m.label}</span> <span className="text-ink">{relTime(m.at)}</span>
    </span>
  )
}

const TH = 'px-3 py-2.5 text-[11.5px] font-medium text-muted'

function DesktopTable({ rows }: { rows: InvestigationSummary[] }) {
  return (
    <div className="panel hidden overflow-x-auto scroll-thin md:block">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-left text-[13.5px]">
        <caption className="sr-only">Investigations, newest first</caption>
        <colgroup>
          <col className="w-[104px]" />
          <col />
          <col className="w-[24%]" />
          <col className="w-[196px]" />
          <col className="w-[156px]" />
          <col className="w-[156px]" />
        </colgroup>
        <thead className="border-b border-line">
          <tr>
            <th scope="col" className={`${TH} pl-4`}>
              ID
            </th>
            <th scope="col" className={TH}>
              Title
            </th>
            <th scope="col" className={TH}>
              Scenario
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH}>
              <abbr title="Latest recorded lifecycle time: resolved, abandoned, or opened" className="no-underline">
                Opened / closed
              </abbr>
            </th>
            <th scope="col" className={`${TH} pr-4 text-right`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-line-2 align-middle transition-colors last:border-b-0 hover:bg-canvas/60">
              <td className="whitespace-nowrap py-3 pl-4 pr-3 font-mono text-[12.5px] font-medium text-ink">{i.id}</td>
              <td className="px-3 py-3">
                <div className="truncate text-ink" title={i.title}>
                  {i.title}
                </div>
                <div className="text-[12px] text-faint">{i.mode === 'challenge' ? 'Challenge' : 'Guided'}</div>
              </td>
              <td className="truncate px-3 py-3">
                <ScenarioCell i={i} />
              </td>
              <td className="px-3 py-3">
                <StatusPill status={i.status} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-[13px]">
                <When i={i} />
              </td>
              <td className="whitespace-nowrap py-3 pl-3 pr-4 text-right">
                <Actions i={i} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MobileList({ rows }: { rows: InvestigationSummary[] }) {
  return (
    <ul className="panel divide-y divide-line-2 md:hidden" aria-label="Investigations">
      {rows.map((i) => (
        <li key={i.id} className="px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12.5px] font-medium text-ink">{i.id}</span>
            <StatusPill status={i.status} />
          </div>
          <div className="mt-1 leading-snug text-ink">{i.title}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[12.5px]">
            {i.scenario.key === 'undisclosed' || i.scenario.title !== i.title ? (
              <>
                <ScenarioCell i={i} />
                <span className="text-faint">·</span>
              </>
            ) : null}
            <span className="text-muted">{i.mode === 'challenge' ? 'Challenge' : 'Guided'}</span>
            <span className="text-faint">·</span>
            <When i={i} />
          </div>
          <div className="mt-2.5">
            <Actions i={i} />
          </div>
        </li>
      ))}
    </ul>
  )
}
