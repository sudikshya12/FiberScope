import clsx from 'clsx'
import type { Topology } from '../../lib/types'
import { STATUS_META, type ObservationMap } from '../../lib/observations'
import { endpointPath, pathText } from './layout'
import type { Selection } from './TopologyCanvas'

/** Accessible list alternative to the graph: devices, links on the scenario path, and the textual path. */
export function TopologyList({ topo, obs, focus, onSelect, selection }: { topo: Topology; obs: ObservationMap; focus: { src: string; dst: string }; onSelect: (s: Selection) => void; selection: Selection }) {
  const path = endpointPath(topo, focus.src, focus.dst)
  const other = topo.links.filter((l) => !path.includes(l))
  const linkRow = (l: (typeof topo.links)[number]) => {
    const st = obs.link[l.id]?.status ?? 'unknown'
    const m = STATUS_META[st]
    return (
      <li key={l.id}>
        <button onClick={() => onSelect({ kind: 'link', id: l.id })} className={clsx('flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-canvas', selection?.kind === 'link' && selection.id === l.id && 'bg-accent-soft')}>
          <span className="mt-0.5 w-4 text-center font-mono text-[12px] font-bold" style={{ color: m.color }} aria-hidden>
            {m.symbol}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block break-all font-mono text-[12.5px] text-ink">
              {l.a} ↔ {l.b}
            </span>
            <span className="block text-[12px] text-muted">
              {m.label} · {l.path.cables.join(' → ')}
            </span>
          </span>
        </button>
      </li>
    )
  }
  return (
    <div className="scroll-thin h-full overflow-y-auto bg-white">
      <section aria-labelledby="tl-path" className="border-b border-line-2">
        <h3 id="tl-path" className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-muted">
          Path {focus.src} → {focus.dst}
        </h3>
        <ul className="divide-y divide-line-2">{path.map(linkRow)}</ul>
        <p className="break-words px-4 pb-3 pt-1 font-mono text-[11.5px] leading-relaxed text-muted">{pathText(topo, focus.src, focus.dst)}</p>
      </section>
      <section aria-labelledby="tl-dev" className="border-b border-line-2">
        <h3 id="tl-dev" className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-muted">
          Devices
        </h3>
        <ul className="grid divide-y divide-line-2 sm:grid-cols-2 sm:divide-y-0">
          {topo.devices.map((d) => {
            const o = obs.device[d.id]
            const st = o?.worst ?? 'unknown'
            const m = STATUS_META[st]
            const label = d.is_passive ? 'Passive panel (modeled)' : o?.unreachable && o.portWorst !== 'down' ? 'Unreachable (symptom)' : m.label
            return (
              <li key={d.id}>
                <button onClick={() => onSelect({ kind: 'device', id: d.id })} className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-canvas', selection?.kind === 'device' && selection.id === d.id && 'bg-accent-soft')}>
                  <span className="w-4 text-center font-mono text-[12px] font-bold" style={{ color: d.is_passive ? '#8a8692' : m.color }} aria-hidden>
                    {d.is_passive ? '·' : m.symbol}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-ink">{d.name}</span>
                    <span className="block font-mono text-[11px] text-muted">
                      {d.id} · {label}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
      {other.length > 0 && (
        <section aria-labelledby="tl-other">
          <h3 id="tl-other" className="px-4 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-wider text-muted">
            Other links
          </h3>
          <ul className="divide-y divide-line-2">{other.map(linkRow)}</ul>
        </section>
      )}
    </div>
  )
}
