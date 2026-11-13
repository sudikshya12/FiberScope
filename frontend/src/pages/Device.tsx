import { Fragment, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import { ArrowLeft, ArrowLeftRight, ArrowUpRight, Cable as CableIcon, ChevronDown, FileSearch, Network, Router, Server, ServerOff, Unplug } from 'lucide-react'
import { Page } from '../components/AppShell'
import { Badge, EmptyState, ErrorState, Skeleton, SourceBadge, Tip, VerdictBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useTopology } from '../lib/hooks'
import { fmtDate, ifaceShort, relTime } from '../lib/format'
import type { Device, Iface, Topology, Verdict } from '../lib/types'
import { MEDIA_LABEL } from '../components/cables/model'

const ROLE: Record<Device['role'], { label: string; icon: ReactNode }> = {
  server: { label: 'Server', icon: <Server className="size-5" /> },
  access_switch: { label: 'Access switch', icon: <Network className="size-5" /> },
  patch_panel: { label: 'Patch panel', icon: <Unplug className="size-5" /> },
  gateway: { label: 'Gateway', icon: <Router className="size-5" /> },
}

const KIND: Record<string, string> = { data: 'Data', uplink: 'Uplink', mgmt: 'Mgmt', patch_front: 'Front', patch_rear: 'Rear', routed: 'Routed', svi: 'SVI' }

/** Link styled like the kit's Button (avoids nesting <button> inside <a>). */
const linkBtn = (variant: 'primary' | 'secondary', sm = false) =>
  clsx(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 active:scale-[0.98]',
    sm ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
    variant === 'primary' ? 'bg-accent text-white hover:bg-accent-strong' : 'border border-line bg-white text-ink hover:border-[#cfc9d6] hover:bg-[#fbfafc]',
  )

const dash = <span className="text-faint">—</span>

function PortLink({ id, className }: { id: string; className?: string }) {
  const dev = id.split(':')[0]
  const port = id.split(':').slice(1).join(':')
  return (
    <Link to={`/devices/${dev}`} className={clsx('group inline-flex items-baseline gap-1 whitespace-nowrap hover:text-accent-strong', className)}>
      <span className="text-[12px] text-muted group-hover:text-accent-strong">{dev}</span>
      <span className="font-mono text-[12.5px] font-medium text-ink group-hover:text-accent-strong group-hover:underline underline-offset-2">{ifaceShort(port)}</span>
    </Link>
  )
}

function CableLink({ id }: { id: string | null }) {
  if (!id) return <span className="text-[12px] italic text-faint">none recorded</span>
  return (
    <Link to={`/cables?id=${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-line bg-white px-1.5 py-0.5 font-mono text-[12px] font-medium text-ink hover:border-accent/40 hover:text-accent-strong">
      <CableIcon className="size-3 text-faint" aria-hidden />
      {id}
    </Link>
  )
}

function Fact({ k, children, mono, wrap }: { k: string; children: ReactNode; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="eyebrow text-[10.5px]">{k}</dt>
      <dd className={clsx('mt-1 text-[14px] leading-snug text-ink', !wrap && 'truncate', mono && 'font-mono text-[13px]')}>{children}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ optic */

function OpticCell({ i }: { i: Iface }) {
  const o = i.optic
  if (!o) return <span className="text-[12px] text-faint">{i.media === 'copper' || i.media === 'dac' ? `none (${i.media})` : '—'}</span>
  return (
    <div className="min-w-0">
      <div className="whitespace-nowrap font-mono text-[12.5px] font-medium text-ink">{o.standard}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge tone={o.dom_supported ? 'outline' : 'neutral'} title={o.dom_supported ? 'Module reports digital optical monitoring' : 'No DOM — optical power cannot be read'}>
          {o.dom_supported ? '✓ DOM' : '✕ No DOM'}
        </Badge>
        <Badge tone={o.thresholds_available ? 'outline' : 'neutral'} title={o.threshold_source}>
          {o.thresholds_available ? '✓ Thresholds' : '? No thresholds'}
        </Badge>
      </div>
    </div>
  )
}

const TH_LABEL: Record<string, string> = { rx_power_dbm: 'Rx power (dBm)', tx_power_dbm: 'Tx power (dBm)', temperature_c: 'Temperature (°C)', voltage_v: 'Voltage (V)', bias_ma: 'Bias (mA)' }

function OpticDetail({ i }: { i: Iface }) {
  const o = i.optic!
  return (
    <div className="grid gap-4 px-4 py-3.5 md:grid-cols-[260px_minmax(0,1fr)]">
      <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-muted">Module</dt>
        <dd className="font-mono text-ink">{o.id}</dd>
        <dt className="text-muted">Vendor / PN</dt>
        <dd className="truncate text-ink">
          {o.vendor} · <span className="font-mono">{o.part_number}</span>
        </dd>
        <dt className="text-muted">Serial</dt>
        <dd className="font-mono text-ink">{o.serial}</dd>
        <dt className="text-muted">Form / λ</dt>
        <dd className="text-ink">
          {o.form_factor} · {o.wavelength_nm ? `${o.wavelength_nm} nm` : 'λ not recorded'}
        </dd>
      </dl>
      <div className="min-w-0">
        {o.thresholds ? (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[420px] text-[12px]">
              <caption className="mb-1 text-left text-[11.5px] text-muted">Alarm / warning thresholds — {o.threshold_source}</caption>
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.06em] text-faint">
                  <th scope="col" className="py-1 pr-3 text-left font-semibold">Parameter</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold text-crit/80">Low alarm</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold text-warn/80">Low warn</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold text-warn/80">High warn</th>
                  <th scope="col" className="px-2 py-1 text-right font-semibold text-crit/80">High alarm</th>
                </tr>
              </thead>
              <tbody className="font-mono tnum">
                {Object.entries(o.thresholds).map(([k, t]) => (
                  <tr key={k} className="border-t border-line-2">
                    <th scope="row" className="py-1 pr-3 text-left font-sans font-normal text-ink">{TH_LABEL[k] ?? k}</th>
                    <td className="px-2 py-1 text-right">{t.low_alarm ?? '—'}</td>
                    <td className="px-2 py-1 text-right">{t.low_warning ?? '—'}</td>
                    <td className="px-2 py-1 text-right">{t.high_warning ?? '—'}</td>
                    <td className="px-2 py-1 text-right">{t.high_alarm ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Module does not expose alarm/warning thresholds; readings cannot be judged against vendor limits.</p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ active-device interfaces */

function L2({ i }: { i: Iface }) {
  if (!i.switchport_mode && i.intended_vlan == null && !i.intended_allowed_vlans) return dash
  return (
    <div className="text-[12.5px]">
      {i.switchport_mode && <div className="font-medium capitalize text-ink">{i.switchport_mode}</div>}
      {i.intended_vlan != null && <div className="text-muted">VLAN <span className="font-mono text-ink">{i.intended_vlan}</span></div>}
      {i.intended_allowed_vlans && <div className="text-muted">allowed <span className="font-mono text-ink">{i.intended_allowed_vlans.join(',')}</span></div>}
    </div>
  )
}

function Addr({ i }: { i: Iface }) {
  if (!i.ipv4_cidr && !i.ipv6_cidr && !i.mac) return dash
  return (
    <div className="min-w-0 font-mono text-[12px] leading-[1.55]">
      {i.ipv4_cidr && <div className="truncate text-ink">{i.ipv4_cidr}</div>}
      {i.ipv6_cidr && <div className="truncate text-ink">{i.ipv6_cidr}</div>}
      {i.mac && <div className="truncate text-faint">{i.mac}</div>}
    </div>
  )
}

function InterfacesTable({ ifaces }: { ifaces: Iface[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <div className="hidden overflow-x-auto scroll-thin lg:block">
        <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
          <caption className="sr-only">Interfaces with intended configuration, optic and cabling</caption>
          <thead className="bg-stage">
            <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
              {['Interface', 'Media', 'Addressing', 'Intended L2', 'MTU', 'Optic', 'Cable', 'Peer'].map((h, idx) => (
                <th key={h} scope="col" className={clsx('border-b border-line px-3 py-2.5', idx === 0 && 'pl-4', idx === 4 && 'text-right')}>
                  {h}
                </th>
              ))}
              <th scope="col" className="w-10 border-b border-line pr-3">
                <span className="sr-only">Optic details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ifaces.map((i) => {
              const isOpen = open === i.id
              return (
                <Fragment key={i.id}>
                  <tr className={clsx('align-top transition-colors hover:bg-stage', isOpen && 'bg-stage')}>
                    <th scope="row" className="border-b border-line-2 py-2.5 pl-4 pr-3 text-left font-normal">
                      <div className="font-mono text-[13px] font-semibold text-ink">{i.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{KIND[i.kind] ?? i.kind}</span>
                      </div>
                      {i.description && <div className="mt-0.5 max-w-[200px] text-[11.5px] leading-snug text-muted">{i.description}</div>}
                    </th>
                    <td className="border-b border-line-2 px-3 py-2.5">
                      <div className="text-[12.5px] text-ink">{MEDIA_LABEL[i.media] ?? i.media}</div>
                      <div className="tnum whitespace-nowrap text-[12px] text-muted">{i.speed_gbps ? `${i.speed_gbps} Gb/s` : 'speed n/a'}</div>
                    </td>
                    <td className="max-w-[210px] border-b border-line-2 px-3 py-2.5">
                      <Addr i={i} />
                    </td>
                    <td className="border-b border-line-2 px-3 py-2.5">
                      <L2 i={i} />
                    </td>
                    <td className="tnum border-b border-line-2 px-3 py-2.5 text-right font-mono text-[12.5px]">{i.intended_mtu ?? dash}</td>
                    <td className="border-b border-line-2 px-3 py-2.5">
                      <OpticCell i={i} />
                    </td>
                    <td className="border-b border-line-2 px-3 py-2.5">
                      <CableLink id={i.cable_id} />
                    </td>
                    <td className="border-b border-line-2 px-3 py-2.5">{i.peer ? <PortLink id={i.peer} /> : <span className="text-[12px] italic text-faint">{i.kind === 'mgmt' ? 'out-of-band' : 'no link'}</span>}</td>
                    <td className="border-b border-line-2 py-2.5 pr-3 text-right">
                      {i.optic && (
                        <button onClick={() => setOpen(isOpen ? null : i.id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} optic details for ${i.name}`} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink">
                          <ChevronDown className={clsx('size-4 transition-transform', isOpen && 'rotate-180')} />
                        </button>
                      )}
                    </td>
                  </tr>
                  <AnimatePresence initial={false}>
                    {isOpen && i.optic && (
                      <tr>
                        <td colSpan={9} className="border-b border-line-2 bg-stage p-0">
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                            <OpticDetail i={i} />
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* stacked cards below lg */}
      <ul className="divide-y divide-line-2 lg:hidden">
        {ifaces.map((i) => (
          <li key={i.id} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[14px] font-semibold text-ink">{i.name}</div>
                <div className="text-[11.5px] text-muted">
                  <span className="font-medium uppercase tracking-wide text-faint">{KIND[i.kind] ?? i.kind}</span> · <span>{MEDIA_LABEL[i.media] ?? i.media}</span>
                  {i.speed_gbps ? ` · ${i.speed_gbps} Gb/s` : ''}
                  {i.intended_mtu ? ` · MTU ${i.intended_mtu}` : ''}
                </div>
              </div>
              <CableLink id={i.cable_id} />
            </div>
            {i.description && <p className="mt-1 text-[12px] text-muted">{i.description}</p>}
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <dt className="eyebrow mb-0.5 text-[10px]">Addressing</dt>
                <dd>
                  <Addr i={i} />
                </dd>
              </div>
              <div>
                <dt className="eyebrow mb-0.5 text-[10px]">Intended L2</dt>
                <dd>
                  <L2 i={i} />
                </dd>
              </div>
              <div>
                <dt className="eyebrow mb-0.5 text-[10px]">Optic</dt>
                <dd>
                  <OpticCell i={i} />
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="eyebrow mb-0.5 text-[10px]">Peer</dt>
                <dd>{i.peer ? <PortLink id={i.peer} /> : <span className="italic text-faint">{i.kind === 'mgmt' ? 'out-of-band' : 'no link'}</span>}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}

/* ------------------------------------------------------------------ patch panel mapping */

function farEnd(cableId: string | null, here: string, topo: Topology | undefined): string | null {
  if (!cableId || !topo) return null
  const c = topo.cables.find((x) => x.id === cableId)
  if (!c) return null
  return c.a === here ? c.b : c.a
}

function PanelSide({ i, topo, side }: { i: Iface; topo: Topology | undefined; side: 'front' | 'rear' }) {
  const far = farEnd(i.cable_id, i.id, topo)
  return (
    <div className={clsx('min-w-0 flex-1 rounded-md border px-3 py-2.5', i.cable_id ? 'border-line bg-panel' : 'border-dashed border-line bg-stage')}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[14px] font-semibold text-ink">{i.name}</span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">{side}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <CableLink id={i.cable_id} />
        {far && (
          <span className="flex min-w-0 items-center gap-1 text-[12px] text-muted">
            → <PortLink id={far} />
          </span>
        )}
      </div>
      <div className="mt-1 text-[11.5px] text-faint">{i.description}</div>
    </div>
  )
}

function PatchMapping({ ifaces, topo }: { ifaces: Iface[]; topo: Topology | undefined }) {
  const byId = new Map(ifaces.map((i) => [i.id, i]))
  const fronts = ifaces.filter((i) => i.kind === 'patch_front')
  const pairs = fronts.map((f) => ({ front: f, rear: f.patch_peer ? byId.get(f.patch_peer) ?? null : null }))
  const orphanRears = ifaces.filter((i) => i.kind === 'patch_rear' && !pairs.some((p) => p.rear?.id === i.id))
  return (
    <div className="p-4">
      <p className="mb-3 text-[12.5px] text-muted">Each front port maps to one rear port — two mated connections per crossing. From inventory records (modeled).</p>
      <ol className="space-y-2 max-sm:divide-y max-sm:divide-dashed max-sm:divide-line max-sm:space-y-0">
        {pairs.map((p) => (
          <li key={p.front.id} className="flex flex-col items-stretch gap-2 max-sm:py-4 max-sm:first:pt-0 max-sm:last:pb-0 sm:flex-row sm:items-center">
            <PanelSide i={p.front} topo={topo} side="front" />
            <div className="flex shrink-0 flex-col items-center justify-center px-1 text-faint sm:w-20" aria-label={`${p.front.name} maps to ${p.rear?.name ?? 'nothing'}`}>
              <ArrowLeftRight className="size-4 rotate-90 sm:rotate-0" aria-hidden />
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em]">passive</span>
            </div>
            {p.rear ? (
              <PanelSide i={p.rear} topo={topo} side="rear" />
            ) : (
              <div className="flex-1 rounded-md border border-crit/25 bg-crit-soft px-3 py-2.5 text-[12.5px] text-crit">No rear mapping recorded — path not inferred.</div>
            )}
          </li>
        ))}
      </ol>
      {orphanRears.length > 0 && <p className="mt-3 text-[12px] text-warn">Rear ports without a recorded front mapping: {orphanRears.map((r) => r.name).join(', ')}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export default function DevicePage() {
  const { id = '' } = useParams()
  const q = useQuery({ queryKey: ['device', id], queryFn: () => api.device(id), enabled: !!id, retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 })
  const topo = useTopology()

  if (q.isLoading) {
    return (
      <Page wide>
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="mb-6 h-9 w-72" />
        <Skeleton className="mb-6 h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </Page>
    )
  }
  if (q.isError) {
    const nf = q.error instanceof ApiError && q.error.status === 404
    return (
      <Page>
        <div className="panel mx-auto max-w-xl">
          {nf ? (
            <EmptyState
              icon={<ServerOff className="size-5" />}
              title={`No device "${id}"`}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link to="/workbench" className={linkBtn('primary', true)}>
                    Open network workbench
                  </Link>
                  <Link to="/cables" className={linkBtn('secondary', true)}>
                    Cable registry
                  </Link>
                </div>
              }
            >
              The documented inventory has no device with this ID. Known devices: srv-a, srv-b, pp-01, pp-02, asw-1, asw-2, gw-1.
            </EmptyState>
          ) : (
            <div className="p-4">
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            </div>
          )}
        </div>
      </Page>
    )
  }
  if (!q.data) return null

  const { device: d, interfaces, recent_evidence } = q.data
  const role = ROLE[d.role] ?? { label: d.role, icon: <Server className="size-5" /> }
  const cabled = interfaces.filter((i) => i.cable_id).length
  const isPanel = d.role === 'patch_panel'
  // One source badge in the section header when every item shares it; per item otherwise.
  const uniformSource = recent_evidence.length > 0 && recent_evidence.every((e) => e.source_mode === recent_evidence[0].source_mode) ? recent_evidence[0].source_mode : null

  return (
    <Page wide>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-[12.5px] text-muted">
        <Link to="/workbench" className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden /> Network workbench
        </Link>
        <span className="text-faint">/</span>
        <span className="font-mono text-ink">{d.id}</span>
      </nav>

      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className={clsx('grid size-11 shrink-0 place-items-center rounded-lg border', d.is_passive ? 'border-dashed border-[#cfcad6] bg-stage text-muted' : 'border-nav bg-nav text-nav-text')}>{role.icon}</div>
          <div className="min-w-0">
            <div className="eyebrow mb-1">{role.label}</div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-[28px]">{d.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-canvas px-1.5 py-0.5 font-mono text-[12.5px] text-ink ring-1 ring-line">{d.id}</span>
              {d.is_passive && (
                <Badge tone="outline">
                  <Unplug className="size-3" aria-hidden /> Passive — not an IP device
                </Badge>
              )}
              {d.is_modeled_only && (
                <Tip content="Exists only in the modeled inventory — no live telemetry or CLI.">
                  <span className="cursor-help">
                    <Badge tone="neutral">Modeled</Badge>
                  </span>
                </Tip>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/cables?device=${encodeURIComponent(d.id)}`} className={linkBtn('secondary')}>
            <CableIcon className="size-4" aria-hidden /> Cables on {d.id}
          </Link>
          <Link to="/workbench" className={linkBtn('primary')}>
            <Network className="size-4" aria-hidden /> Open in workbench
          </Link>
        </div>
      </header>

      <dl className="panel mb-6 grid grid-cols-2 divide-line-2 md:grid-cols-4 md:divide-x [&>*]:border-line-2 max-md:[&>*:nth-child(-n+2)]:border-b max-md:[&>*:nth-child(odd)]:border-r">
        <Fact k="Rack / unit" mono>
          {d.rack} / {d.rack_unit ?? '—'}
        </Fact>
        <Fact k="Model" wrap>
          {d.model}
        </Fact>
        <Fact k="Mgmt address" mono>
          {d.mgmt_address ?? <span className="font-sans text-[13px] text-faint">{d.is_passive ? 'None — passive' : 'Not recorded'}</span>}
        </Fact>
        <Fact k="Ports cabled">
          <span className="tnum">
            {cabled} <span className="text-muted">of {interfaces.length}</span>
          </span>
        </Fact>
      </dl>

      {d.notes && (
        <p className="-mt-3 mb-6 max-w-3xl text-[13.5px] leading-relaxed text-muted">
          {d.notes}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5">
        <section className="panel min-w-0 overflow-hidden" aria-labelledby="ifaces-h">
          <header className="panel-head">
            <div>
              <div className="eyebrow mb-0.5">{isPanel ? 'Front ↔ rear mapping' : 'Interfaces'}</div>
              <h2 id="ifaces-h" className="text-[15px] font-semibold text-ink">
                {isPanel ? `${interfaces.filter((i) => i.kind === 'patch_front').length} mapped port pairs` : `${interfaces.length} interfaces · intended configuration`}
              </h2>
            </div>
            {!isPanel && <span className="hidden text-[11.5px] text-faint sm:block">Intended values from inventory — not live state</span>}
          </header>
          {interfaces.length === 0 ? <EmptyState title="No interfaces recorded" /> : isPanel ? <PatchMapping ifaces={interfaces} topo={topo.data} /> : <InterfacesTable ifaces={interfaces} />}
        </section>

        <section className="panel min-w-0 overflow-hidden" aria-labelledby="ev-h">
          <header className="panel-head">
            <div>
              <div className="eyebrow mb-0.5">Evidence</div>
              <h2 id="ev-h" className="text-[15px] font-semibold text-ink">
                Recent evidence
              </h2>
            </div>
            {recent_evidence.length > 0 && (
              <span className="flex items-center gap-2">
                {uniformSource && <SourceBadge mode={uniformSource} />}
                <span className="font-mono text-[11px] text-faint">{recent_evidence.length}</span>
              </span>
            )}
          </header>
          {recent_evidence.length === 0 ? (
            <EmptyState icon={<FileSearch className="size-5" />} title="No evidence yet" action={<Link to="/scenarios" className={linkBtn('secondary', true)}>Start a scenario</Link>}>
              {isPanel ? 'Passive panels produce no telemetry; evidence about this panel comes from tracing and inspection steps.' : 'Diagnostics that target this device will be listed here.'}
            </EmptyState>
          ) : (
            <ul className="-mb-px grid md:grid-cols-2">
              {recent_evidence.map((e) => {
                const inner = (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-[13px] font-medium leading-snug text-ink">{e.title}</span>
                      <VerdictBadge verdict={(e.verdict as Verdict) ?? 'info'} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                      {!uniformSource && <SourceBadge mode={e.source_mode} />}
                      <span title={fmtDate(e.collected_at)}>{relTime(e.collected_at)}</span>
                      {e.investigation_id && (
                        <span className="ml-auto inline-flex items-center gap-0.5 font-mono text-[11px] text-accent-strong">
                          {e.investigation_id.slice(0, 10)}
                          <ArrowUpRight className="size-3" aria-hidden />
                        </span>
                      )}
                    </div>
                  </>
                )
                return (
                  <li key={e.id} className="border-b border-line-2 md:odd:border-r">
                    {e.investigation_id ? (
                      <Link to={`/investigations/${e.investigation_id}`} className="block h-full px-4 py-3 transition-colors hover:bg-stage">
                        {inner}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{inner}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </Page>
  )
}
