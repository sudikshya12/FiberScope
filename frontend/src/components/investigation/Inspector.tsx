import { Link } from 'react-router'
import { motion } from 'motion/react'
import { ArrowUpRight, Cable as CableIcon, MousePointerClick, PanelTop } from 'lucide-react'
import type { Evidence, Investigation, Topology } from '../../lib/types'
import type { ObservationMap, ElemObs } from '../../lib/observations'
import { STATUS_META } from '../../lib/observations'
import { api } from '../../lib/api'
import { useInvMutation } from '../../lib/hooks'
import { fmtTime } from '../../lib/format'
import { Badge, Button, InlineError, KV, Mono } from '../ui'
import type { Selection } from '../topology/TopologyCanvas'

function ObsLine({ o, label = 'Latest observation' }: { o?: ElemObs; label?: string }) {
  if (!o)
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">
        {label}: <span className="font-medium text-ink">not observed</span> — run a diagnostic to collect evidence.
      </div>
    )
  const m = STATUS_META[o.status]
  return (
    <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: m.soft }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold" style={{ color: m.color }}>
          {m.symbol} {m.label}
        </span>
        <Mono className="text-[10.5px] text-muted">{o.evidenceId}</Mono>
      </div>
      <div className="mt-0.5 text-ink/85">{o.label}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-muted">
        {fmtTime(o.at)}
        {o.stale && ' · observed before fault (stale)'}
      </div>
    </div>
  )
}

function Quick({ inv, onEvidence, items }: { inv?: Investigation; onEvidence: (e: Evidence) => void; items: { label: string; action: string; target: Record<string, unknown>; params?: Record<string, unknown> }[] }) {
  const m = useInvMutation(inv?.id, async (it: (typeof items)[number]) => {
    const r = await api.diagnostic(inv!.id, it.action, it.target, it.params ?? {})
    onEvidence(r.evidence)
    return r
  })
  const closed = !inv || inv.status === 'resolved' || inv.status === 'abandoned'
  if (!items.length) return null
  return (
    <div>
      <div className="eyebrow mb-1.5">Quick diagnostics</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <Button key={it.label} size="sm" variant="subtle" disabled={closed} loading={m.isPending && m.variables?.label === it.label} onClick={() => m.mutate(it)}>
            {it.label}
          </Button>
        ))}
      </div>
      {closed && <p className="mt-1.5 text-[11px] text-muted">{inv ? 'Investigation closed.' : 'Start an investigation to run diagnostics.'}</p>}
      <InlineError error={m.error} />
    </div>
  )
}

export function Inspector({ topo, obs, selection, inv, onEvidence, onSelect }: { topo: Topology; obs: ObservationMap; selection: Selection; inv?: Investigation; onEvidence: (e: Evidence) => void; onSelect: (s: Selection) => void }) {
  const byIface = Object.fromEntries(topo.interfaces.map((i) => [i.id, i]))
  if (!selection)
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-line bg-canvas/60 p-3">
          <MousePointerClick className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-muted">Select a device, a port, or a cable label on the topology to inspect documented configuration, the latest observation, and run diagnostics against it.</p>
        </div>
        <div>
          <div className="eyebrow mb-1">{topo.environment?.name}</div>
          <p className="text-[12.5px] leading-relaxed text-muted">{topo.environment?.description}</p>
        </div>
        <details className="group rounded-md border border-line-2 [&_summary::-webkit-details-marker]:hidden"><summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-canvas">Properties<span className="text-muted transition-transform group-open:rotate-90" aria-hidden>›</span></summary><dl className="divide-y divide-line-2 border-t border-line-2 px-3">
          <KV k="Devices" v={topo.devices.length} />
          <KV k="Cable segments" v={topo.cables.length} />
          <KV k="L1 links (traced)" v={topo.links.length} />
          <KV k="VLANs" v={topo.vlans.map((v) => `${v.id} ${v.name}`).join(' · ')} />
          <KV k="Data subnet" v="192.0.2.0/24" mono />
          <KV k="Source" v={topo.source} />
        </dl></details>
      </div>
    )

  if (selection.kind === 'device') {
    const d = topo.devices.find((x) => x.id === selection.id)!
    const ports = topo.interfaces.filter((i) => i.device_id === d.id)
    const dev = obs.device[d.id]
    return (
      <motion.div key={d.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-semibold text-ink">{d.name}</h3>
            {d.is_passive && <Badge>Passive</Badge>}
            {d.is_modeled_only && <Badge tone="outline">Modeled</Badge>}
          </div>
          <Mono className="text-muted">{d.id}</Mono>
          <p className="mt-1.5 text-[12.5px] text-muted">{d.notes}</p>
        </div>
        <details className="group rounded-md border border-line-2 [&_summary::-webkit-details-marker]:hidden"><summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-canvas">Properties<span className="text-muted transition-transform group-open:rotate-90" aria-hidden>›</span></summary><dl className="divide-y divide-line-2 border-t border-line-2 px-3">
          <KV k="Role" v={d.role.replace('_', ' ')} />
          <KV k="Rack" v={`${d.rack} ${d.rack_unit ?? ''}`} mono />
          <KV k="Model" v={d.model} />
          {d.mgmt_address && <KV k="Mgmt (OOB)" v={d.mgmt_address} mono />}
          <KV k="Observed status" v={dev ? STATUS_META[dev.worst].label : '—'} />
        </dl></details>
        <div>
          <div className="eyebrow mb-1.5">Ports</div>
          <ul className="space-y-1">
            {ports.map((p) => {
              const o = obs.iface[p.id] ?? obs.optic[p.id]
              const m = STATUS_META[o?.status ?? 'unknown']
              return (
                <li key={p.id}>
                  <button onClick={() => onSelect({ kind: 'interface', id: p.id })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-canvas">
                    <span className="font-mono text-[11px] font-bold" style={{ color: m.color }} aria-hidden>
                      {m.symbol}
                    </span>
                    <Mono className="text-ink">{p.name}</Mono>
                    <span className="truncate text-[11.5px] text-muted">{p.kind}</span>
                    <span className="ml-auto truncate font-mono text-[10.5px] text-faint">{p.cable_id ?? (p.kind === 'mgmt' ? 'OOB' : '—')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        {!d.is_passive && (
          <Quick
            inv={inv}
            onEvidence={onEvidence}
            items={[
              ...(d.role === 'access_switch' ? [{ label: 'VLAN membership', action: 'vlan_membership', target: { device: d.id } }, { label: 'MAC table', action: 'neighbor_table', target: { device: d.id } }] : [{ label: 'Neighbor table', action: 'neighbor_table', target: { device: d.id } }]),
              { label: 'Routing', action: 'routing', target: { device: d.id } },
            ]}
          />
        )}
        <Link to={`/devices/${d.id}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-strong hover:underline">
          Device detail <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </motion.div>
    )
  }

  if (selection.kind === 'interface') {
    const i = byIface[selection.id]
    if (!i) return null
    const passive = i.device_id.startsWith('pp-')
    const items = passive
      ? [{ label: 'Trace path', action: 'cable_trace', target: { interface: i.id } }, ...(topo.inspection_points.includes(i.id) ? [{ label: 'Scope inspection', action: 'connector_inspection', target: { location: i.id } }] : [])]
      : [
          { label: 'Interface state', action: 'interface_state', target: { interface: i.id } },
          { label: 'Counters', action: 'interface_counters', target: { interface: i.id } },
          ...(i.optic ? [{ label: 'Optics (both ends)', action: 'optical_telemetry', target: { interface: i.id } }] : []),
          ...(i.kind !== 'mgmt' ? [{ label: 'Trace path', action: 'cable_trace', target: { interface: i.id } }] : []),
          ...(i.kind === 'uplink' ? [{ label: 'Impairment rules', action: 'impairment_inspect', target: { interface: i.id } }] : []),
          ...(topo.inspection_points.includes(i.id) ? [{ label: 'Scope inspection', action: 'connector_inspection', target: { location: i.id } }] : []),
        ]
    return (
      <motion.div key={i.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
        <div>
          <div className="eyebrow mb-0.5">{passive ? 'Patch-panel port' : 'Interface'}</div>
          <h3 className="break-all font-mono text-[15px] font-semibold text-ink">{i.id}</h3>
          <p className="mt-1 text-[12.5px] text-muted">{i.description}</p>
        </div>
        {!passive && <ObsLine o={obs.iface[i.id]} label="Interface state" />}
        {i.optic && <ObsLine o={obs.optic[i.id]} label="Optical telemetry" />}
        {passive && <ObsLine o={obs.mated[i.id]} label="Connector inspection" />}
        <Quick inv={inv} onEvidence={onEvidence} items={items} />
        <details className="group rounded-md border border-line-2 [&_summary::-webkit-details-marker]:hidden"><summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-canvas">Properties<span className="text-muted transition-transform group-open:rotate-90" aria-hidden>›</span></summary><dl className="divide-y divide-line-2 border-t border-line-2 px-3">
          <KV k="Kind / media" v={`${i.kind} · ${i.media}${i.speed_gbps ? ` · ${i.speed_gbps}G` : ''}`} />
          {i.ipv4_cidr && <KV k="IPv4" v={i.ipv4_cidr} mono />}
          {i.ipv6_cidr && <KV k="IPv6" v={i.ipv6_cidr} mono />}
          {i.mac && <KV k="MAC" v={i.mac} mono />}
          {i.switchport_mode && <KV k="Mode (intended)" v={i.switchport_mode} />}
          {i.intended_vlan != null && <KV k="VLAN (intended)" v={i.intended_vlan} mono />}
          {i.intended_allowed_vlans && <KV k="Allowed (intended)" v={i.intended_allowed_vlans.join(', ')} mono />}
          {i.intended_mtu != null && <KV k="MTU (intended)" v={i.intended_mtu} mono />}
          {i.patch_peer && <KV k="Panel mapping" v={`${i.name} ⇄ ${i.patch_peer.split(':')[1]}`} mono />}
          <KV k="Cable" v={i.cable_id ? <button className="font-mono text-accent-strong hover:underline" onClick={() => onSelect({ kind: 'cable', id: i.cable_id! })}>{i.cable_id}</button> : 'none recorded'} />
          {i.peer && <KV k="Link peer" v={i.peer} mono />}
          {i.optic && <KV k="Optic" v={`${i.optic.standard} · ${i.optic.dom_supported ? 'DOM' : 'no DOM'} · ${i.optic.thresholds_available ? 'thresholds' : 'thresholds unknown'}`} />}
        </dl></details>
      </motion.div>
    )
  }

  const cable = selection.kind === 'cable' ? topo.cables.find((c) => c.id === selection.id) : undefined
  const link = selection.kind === 'link' ? topo.links.find((l) => l.id === selection.id) : topo.links.find((l) => cable && l.path.cables.includes(cable.id))
  return (
    <motion.div key={selection.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
      {cable && (
        <>
          <div>
            <div className="eyebrow mb-0.5 flex items-center gap-1">
              <CableIcon className="size-3" aria-hidden /> Cable segment
            </div>
            <h3 className="font-mono text-[16px] font-semibold text-ink">{cable.id}</h3>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone="outline">{cable.kind.replace('_', ' ')}</Badge>
              <Badge tone="outline">Modeled</Badge>
              {cable.label_status !== 'labeled' && <Badge tone="warn">Label {cable.label_status}</Badge>}
            </div>
          </div>
          <details className="group rounded-md border border-line-2 [&_summary::-webkit-details-marker]:hidden"><summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-canvas">Properties<span className="text-muted transition-transform group-open:rotate-90" aria-hidden>›</span></summary><dl className="divide-y divide-line-2 border-t border-line-2 px-3">
            <KV k="End A" v={cable.a} mono />
            <KV k="End B" v={cable.b} mono />
            <KV k="Media" v={cable.media} />
            {cable.fiber_type && <KV k="Fiber" v={cable.fiber_type} />}
            <KV k="Connectors" v={`${cable.connector_a}${cable.connector_b !== cable.connector_a ? ` / ${cable.connector_b}` : ''}`} />
            <KV k="Nominal length" v={cable.nominal_length_m != null ? `${cable.nominal_length_m} m` : 'unknown'} mono />
            {cable.trunk_id && <KV k="Trunk" v={cable.trunk_id} mono />}
          </dl></details>
        </>
      )}
      {link && (
        <div>
          <div className="eyebrow mb-1.5 flex items-center gap-1">
            <PanelTop className="size-3" aria-hidden /> End-to-end L1 link
          </div>
          <ObsLine o={obs.link[link.id]?.status !== 'unknown' ? obs.link[link.id] : undefined} label="Link (from end observations)" />
          <ol className="mt-2 space-y-0.5 border-l-2 border-line pl-3">
            {link.path.hops.map((h, idx) => (
              <motion.li key={`${h.id}-${idx}`} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.035 }} className="relative font-mono text-[11px]">
                <span className="absolute -left-[17px] top-1.5 size-2 rounded-full border-2 border-white" style={{ background: h.kind === 'cable' ? '#6941C6' : h.kind === 'patch_mapping' ? '#8a8692' : '#172033' }} aria-hidden />
                <span className={h.kind === 'cable' ? 'font-semibold text-accent-strong' : h.kind === 'patch_mapping' ? 'text-muted' : 'text-ink'}>{h.label}</span>
                {h.detail && <span className="ml-1 text-faint">{h.detail}</span>}
              </motion.li>
            ))}
          </ol>
          {link.planning_budget && (
            <p className="mt-2 text-[11.5px] text-muted">
              Planning loss budget ≈ <Mono className="text-ink">{link.planning_budget.estimated_budget_db} dB</Mono> ({link.planning_budget.fiber_length_m} m, {link.planning_budget.mated_pairs} mated pairs × {link.planning_budget.assumed_loss_per_mated_pair_db} dB assumed). Estimate from documentation, not a measurement.
            </p>
          )}
        </div>
      )}
      <Quick inv={inv} onEvidence={onEvidence} items={link ? [{ label: 'Trace documented path', action: 'cable_trace', target: { interface: link.b.startsWith('srv') ? link.b : link.a } }] : []} />
      {cable && (
        <Link to={`/cables?id=${cable.id}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-strong hover:underline">
          Open in cable registry <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </motion.div>
  )
}
