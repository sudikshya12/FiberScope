import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Activity, FlaskConical, Presentation, Sun, X } from 'lucide-react'
import { Page } from '../components/AppShell'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Skeleton, SourceBadge } from '../components/ui'
import { api } from '../lib/api'
import { useInvestigations, useTopology } from '../lib/hooks'
import { fmtSim, fmtTime, ifaceShort } from '../lib/format'
import { EndpointCard } from '../components/optics/EndpointCard'
import { EstimateTag, LossEstimate } from '../components/optics/LossEstimate'
import { OpticHistoryChart } from '../components/optics/OpticHistoryChart'
import { OpticDetails } from '../components/optics/OpticDetails'
import { CablePath } from '../components/optics/CablePath'
import { Disclosure } from '../components/optics/Disclosure'
import { ThresholdLegend } from '../components/optics/ThresholdBar'
import { latestFor, latestPair } from '../components/optics/model'

const DEFAULT_LINK = 'asw-1:Ethernet1/1~srv-a:eth0'

export default function Optics() {
  const [params, setParams] = useSearchParams()
  const optics = useQuery({ queryKey: ['optics'], queryFn: api.optics, staleTime: 10_000 })
  const topo = useTopology()
  const invs = useInvestigations()

  const links = useMemo(() => (optics.data?.links ?? []).filter((l) => l.has_optics), [optics.data])
  const requested = params.get('link')
  const linkId = links.find((l) => l.id === requested)?.id ?? links.find((l) => l.id === DEFAULT_LINK)?.id ?? links[0]?.id
  const sel = links.find((l) => l.id === linkId)
  const investigation = params.get('investigation') ?? ''

  const obsQ = useQuery({
    queryKey: ['optics', 'observations', sel?.a, sel?.b, investigation],
    queryFn: () => api.opticalObservations([sel!.a, sel!.b], investigation || undefined),
    enabled: !!sel,
    staleTime: 5_000,
    refetchInterval: 15_000,
  })

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const t = topo.data
  const ifA = t?.interfaces.find((i) => i.id === sel?.a)
  const ifB = t?.interfaces.find((i) => i.id === sel?.b)
  const devA = t?.devices.find((d) => d.id === ifA?.device_id)
  const devB = t?.devices.find((d) => d.id === ifB?.device_id)
  const tLink = t?.links.find((l) => l.id === sel?.id)

  const obs = obsQ.data?.observations ?? []
  const obsA = obs.filter((o) => o.interface_id === sel?.a)
  const obsB = obs.filter((o) => o.interface_id === sel?.b)
  const latestA = sel ? latestFor(obs, sel.a) : null
  const latestB = sel ? latestFor(obs, sel.b) : null
  const latest = obs.length ? obs[obs.length - 1] : null
  const pair = sel ? latestPair(obs, sel.a, sel.b) : null
  const hasModeled = !!tLink?.path.hops.some((h) => h.kind === 'patch_mapping') || !!tLink?.path.cables.some((c) => c.startsWith('TRK'))
  const missingThresholds = [ifA, ifB].filter((i) => i?.optic && !i.optic.thresholds_available)

  const filteredInv = invs.data?.investigations.find((i) => i.id === investigation)

  const loading = optics.isLoading || topo.isLoading
  const error = optics.error || topo.error
  const mated = tLink?.path.mated_points.length ?? 0
  const segments = tLink?.path.cables.length ?? 0

  return (
    <Page>
      <PageHeader
        title="Optical diagnostics"
        description="DOM readings at both ends of a fiber link, judged against each module's own thresholds."
        actions={
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <label htmlFor="optics-inv" className="shrink-0 text-[12.5px] text-muted">
              Observations
            </label>
            <select id="optics-inv" className="field h-9 min-w-0 py-1.5 sm:w-72" value={investigation} onChange={(e) => setParam('investigation', e.target.value || null)} disabled={invs.isLoading}>
              <option value="">All investigations</option>
              {invs.data?.investigations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id} — {i.scenario.title}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            optics.refetch()
            topo.refetch()
          }}
        />
      ) : loading ? (
        <LoadingSkeleton />
      ) : links.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<Sun className="size-5" />} title="No optical links in the inventory">
            The documented inventory has no links with pluggable optics.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-5">
          {/* link selector */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="eyebrow shrink-0" id="link-picker-label">
              Link
            </span>
            <div role="radiogroup" aria-labelledby="link-picker-label" className="flex flex-col rounded-lg border border-line bg-panel p-0.5 sm:inline-flex sm:flex-row">
              {links.map((l) => {
                const active = l.id === linkId
                return (
                  <button
                    key={l.id}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setParam('link', l.id)}
                    title={l.id}
                    className={clsx(
                      'mono min-w-0 truncate rounded-md px-3 py-1.5 text-left text-[12.5px] transition-colors',
                      active ? 'bg-accent-soft font-semibold text-accent-strong' : 'text-muted hover:bg-canvas hover:text-ink',
                    )}
                  >
                    {ifaceShort(l.a)} <span className={active ? 'text-accent/60' : 'text-faint'}>⇄</span> {ifaceShort(l.b)}
                  </button>
                )
              })}
            </div>
          </div>

          {filteredInv && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted" role="status">
              <FlaskConical className="size-3.5 text-faint" aria-hidden />
              Only observations from
              <Link to={`/investigations/${filteredInv.id}`} className="mono font-semibold text-ink underline-offset-2 hover:text-accent-strong hover:underline">
                {filteredInv.id}
              </Link>
              <span className="truncate">({filteredInv.scenario.title})</span>
              <button className="inline-flex items-center gap-1 rounded px-1 font-medium text-accent-strong hover:underline" onClick={() => setParam('investigation', null)}>
                <X className="size-3" aria-hidden /> Show all
              </button>
            </div>
          )}

          {/* instrument */}
          <section className="panel overflow-hidden" aria-labelledby="instrument-h">
            <header className="flex flex-col gap-2 border-b border-line-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <h2 id="instrument-h" className="mono truncate text-[13.5px] font-semibold text-ink" title={sel?.id}>
                  {sel?.a} <span className="text-faint">⇄</span> {sel?.b}
                </h2>
                <div className="text-[12px] text-muted">
                  <span className="capitalize">{tLink?.media ?? sel?.media}</span> · {segments} cable segment{segments === 1 ? '' : 's'} · {mated} mated point{mated === 1 ? '' : 's'}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                {latest ? (
                  <>
                    <span className="hidden sm:inline">Latest</span>
                    <SourceBadge mode={latest.source_mode} />
                    <span className="mono whitespace-nowrap text-ink">
                      {fmtTime(latest.observed_at, true)}
                      {latest.sim_time_ms != null && <span className="text-faint"> · {fmtSim(latest.sim_time_ms)}</span>}
                    </span>
                  </>
                ) : obsQ.isLoading ? null : (
                  <span>No observation recorded</span>
                )}
              </div>
            </header>

            {obsQ.error ? (
              <div className="p-4">
                <ErrorState error={obsQ.error} onRetry={() => obsQ.refetch()} />
              </div>
            ) : obsQ.isLoading ? (
              <div className="grid gap-6 p-5 md:grid-cols-2">
                <Skeleton className="h-[300px]" />
                <Skeleton className="h-[300px]" />
              </div>
            ) : obs.length === 0 ? (
              <EmptyState
                icon={<Activity className="size-5" />}
                title={investigation ? 'No readings for this link in this investigation' : 'No optical observations yet'}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link to="/scenarios" className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-strong">
                      <FlaskConical className="size-4" aria-hidden /> Start “Low optical receive power”
                    </Link>
                    <Link to="/present?story=optical" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
                      <Presentation className="size-4" aria-hidden /> Watch the optical story
                    </Link>
                  </div>
                }
              >
                Readings appear when an investigation runs the <span className="mono text-[12.5px]">optical_telemetry</span> diagnostic. Values are never assumed.
              </EmptyState>
            ) : (
              <>
                <div className="grid md:grid-cols-2 md:divide-x md:divide-line-2 max-md:divide-y max-md:divide-line-2">
                  <EndpointCard end="A" iface={ifA} device={devA} obs={latestA} shared={latest} />
                  <EndpointCard end="B" iface={ifB} device={devB} obs={latestB} shared={latest} />
                </div>
                <ThresholdLegend className="border-t border-line-2 bg-stage px-4 py-2.5 sm:px-5" />
              </>
            )}
          </section>

          {obs.length > 0 && (
            <section className="panel" aria-labelledby="loss-h">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-3 sm:px-5">
                <h2 id="loss-h" className="text-[14px] font-semibold text-ink">
                  Estimated optical loss <span className="font-normal text-muted">· paired Tx/Rx, same evidence</span>
                </h2>
                <EstimateTag />
              </header>
              <div className="px-4 py-4 sm:px-5">
                <LossEstimate pair={pair} opticA={ifA?.optic ?? null} opticB={ifB?.optic ?? null} budget={tLink?.planning_budget ?? null} />
              </div>
            </section>
          )}

          <div className="border-b border-line">
            {obs.length > 0 && sel && (
              <Disclosure title="Observation history" meta={`${obs.length} readings · Rx power over time`}>
                <div className="grid gap-8 lg:grid-cols-2">
                  <OpticHistoryChart iface={sel.a} endLabel="A" observations={obsA} peerObservations={obsB} thresholds={ifA?.optic?.thresholds?.rx_power_dbm ?? null} />
                  <OpticHistoryChart iface={sel.b} endLabel="B" observations={obsB} peerObservations={obsA} thresholds={ifB?.optic?.thresholds?.rx_power_dbm ?? null} />
                </div>
              </Disclosure>
            )}
            <Disclosure
              title="Optic identity & raw telemetry"
              meta={missingThresholds.length ? <span className="text-warn">{missingThresholds.length === 2 ? 'No module reports thresholds' : `${ifaceShort(missingThresholds[0]!.id)} reports no thresholds`}</span> : 'Module, thresholds, raw values'}
            >
              <OpticDetails
                ends={[
                  { end: 'A', iface: ifA, device: devA, obs: latestA },
                  { end: 'B', iface: ifB, device: devB, obs: latestB },
                ]}
              />
            </Disclosure>
            {tLink && (
              <Disclosure title="Documented cable path" meta={`Modeled · ${mated} mated point${mated === 1 ? '' : 's'}`}>
                <CablePath path={tLink.path} />
                <p className="mt-2 text-[11.5px] text-faint">From the cable registry. Patch panels and trunk are documented inventory, not observed.</p>
              </Disclosure>
            )}
            <Disclosure title="Interpreting low receive power" meta="Static guidance">
              <TroubleshootingNotes />
            </Disclosure>
            <Disclosure title="Evidence limitations" meta="Read before concluding">
              <Limitations modeled={hasModeled} noThresholds={missingThresholds.length > 0} />
            </Disclosure>
          </div>
        </div>
      )}
    </Page>
  )
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Low Rx is a symptom of the path, not proof of a component',
    body: 'Candidates: a dirty or damaged connector, excess loss at a mated pair or bend, a weak remote transmitter, a wrong optic/fiber type, or a sensor error.',
  },
  { title: 'Compare the remote transmitter', body: 'Normal remote Tx with low local Rx points at the path in between.' },
  { title: 'Compare both directions', body: 'If only one strand is low, the fault is likely on that strand — not shared equipment.' },
  { title: 'Trace the documented path', body: 'Every mated connection point between the two ends is a candidate to inspect.' },
  {
    title: 'Inspect with a fiber inspection scope',
    body: (
      <>
        Inspect end-faces at each mated point. <strong className="font-semibold text-crit">Never look into a connector or optic port</strong> — invisible laser light can injure eyes.
      </>
    ),
  },
  { title: 'Clean only what fails, then re-read', body: 'Clean only contaminated end-faces, re-inspect, then re-read optics on both ends to verify.' },
]

function TroubleshootingNotes() {
  return (
    <ol className="grid gap-x-8 gap-y-3 md:grid-cols-2">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span className="mono w-4 shrink-0 pt-px text-[12px] font-semibold text-faint">{i + 1}</span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">{s.title}</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Limitations({ modeled, noThresholds }: { modeled: boolean; noThresholds: boolean }) {
  const items = [
    { k: 'DOM accuracy', v: 'Typically accurate to a few dB. Compare trends and both ends rather than single absolute values.' },
    { k: 'Per-module thresholds', v: `Thresholds come from each module. Where none are reported, status is UNKNOWN — no universal defaults are substituted.${noThresholds ? ' A module on this link reports none.' : ''}` },
    { k: 'Simulated values', v: 'Readings labelled SIMULATED come from a deterministic model, not physical transceivers.' },
    ...(modeled ? [{ k: 'Modeled panels and trunk', v: 'Patch panel mappings and the trunk are documented inventory; they are not observed and report no optical values.' }] : []),
    { k: 'Loss estimate', v: 'Tx − Rx from DOM is a rough estimate. It is not an OTDR trace and cannot locate a fault along the fiber.' },
  ]
  return (
    <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
      {items.map((it) => (
        <div key={it.k}>
          <dt className="text-[13px] font-semibold text-ink">{it.k}</dt>
          <dd className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{it.v}</dd>
        </div>
      ))}
    </dl>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-9 w-[480px] max-w-full" />
      <div className="panel p-5">
        <LoadingBlock label="Loading optical inventory…" rows={6} />
      </div>
    </div>
  )
}
