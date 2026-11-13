import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router'
import clsx from 'clsx'
import { motion } from 'motion/react'
import { CheckCircle2, Circle, FileText, RotateCcw, ShieldCheck, Undo2, Wrench, XOctagon, Repeat } from 'lucide-react'
import type { Catalog, Investigation } from '../../lib/types'
import { api } from '../../lib/api'
import { useInvMutation } from '../../lib/hooks'
import { fmtTime } from '../../lib/format'
import { Badge, Button, Dialog, InlineError, Mono } from '../ui'
import { VerificationRunCard } from '../evidence/Evidence'

const REPAIR_TARGETS: Record<string, keyof Catalog['targets'] | 'impairment'> = {
  set_access_vlan: 'access_ports',
  enable_interface: 'interfaces',
  set_mtu: 'interfaces',
  clean_connector: 'locations',
  replace_patch_cable: 'patch_cables',
  replace_optic: 'optic_interfaces',
  remove_impairment: 'impairment',
}

const TARGET_KEY: Record<string, string> = {
  set_access_vlan: 'interface', enable_interface: 'interface', set_mtu: 'interface', clean_connector: 'location',
  replace_patch_cable: 'cable_id', replace_optic: 'interface', remove_impairment: 'impairment_id',
}

export function RepairPanel({ inv, cat, onVerified }: { inv: Investigation; cat: Catalog; onVerified?: () => void }) {
  const mode = inv.execution.source_mode
  const repairs = cat.repairs.filter((r) => r.modes.includes(mode))
  const [action, setAction] = useState(repairs[0]?.key ?? '')
  const impairmentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of inv.evidence) for (const r of (e.payload?.rules as { id?: string }[] | undefined) ?? []) if (r.id) ids.add(r.id)
    return [...ids]
  }, [inv.evidence])
  const options = useMemo(() => {
    const k = REPAIR_TARGETS[action]
    if (k === 'impairment') return impairmentIds
    return k ? (cat.targets[k] as string[]) : []
  }, [action, cat, impairmentIds])
  const [target, setTarget] = useState('')
  const [vlan, setVlan] = useState(20)
  const [mtu, setMtu] = useState<number>(9216)
  const [notes, setNotes] = useState('')
  useEffect(() => setTarget(options[0] ?? ''), [options])
  useEffect(() => {
    if (action === 'set_mtu' && target) setMtu(cat.targets.intended_mtu[target] ?? 1500)
  }, [action, target, cat])
  const apply = useInvMutation(inv.id, () =>
    api.repair(inv.id, action, { [TARGET_KEY[action]]: target }, action === 'set_access_vlan' ? { vlan } : action === 'set_mtu' ? { mtu } : {}, notes),
  )
  const verify = useInvMutation(inv.id, async (_: void) => {
    const r = await api.verify(inv.id)
    onVerified?.()
    return r
  })
  const [lessons, setLessons] = useState(inv.lessons_learned)
  const resolve = useInvMutation(inv.id, () => api.resolve(inv.id, lessons))
  const reopen = useInvMutation(inv.id, () => api.reopen(inv.id, 'Reopened from workbench'))
  const [confirm, setConfirm] = useState<null | 'abandon' | 'reset'>(null)
  const [reason, setReason] = useState('')
  const abandon = useInvMutation(inv.id, () => api.abandon(inv.id, reason))
  const reset = useInvMutation(inv.id, () => api.reset(inv.id))
  const nav = useNavigate()
  const [restarting, setRestarting] = useState(false)

  const closed = inv.status === 'resolved' || inv.status === 'abandoned'
  const noDiag = !inv.diagnosis
  const allMet = inv.resolution_criteria.every((c) => c.met)
  const lastRun = inv.verifications[inv.verifications.length - 1]
  const spec = repairs.find((r) => r.key === action)

  return (
    <div className="space-y-5">
      <section>
        <h3 className="eyebrow mb-2 flex items-center gap-1.5">
          <Wrench className="size-3.5" aria-hidden /> Corrective action
        </h3>
        {noDiag && !closed && (
          <p className="mb-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[12px] text-warn">Record a diagnosis with cited evidence before changing anything — repairs are locked until then.</p>
        )}
        {!closed && (
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              apply.mutate()
            }}
          >
            <div>
              <label htmlFor="rep-action" className="label">
                Action
              </label>
              <select id="rep-action" className="field text-[13px]" value={action} onChange={(e) => setAction(e.target.value)} disabled={noDiag}>
                {repairs.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              {spec && <p className="mt-1 text-[11.5px] text-muted">{spec.purpose}</p>}
            </div>
            <div className={clsx('grid gap-2', action === 'set_access_vlan' || action === 'set_mtu' ? 'grid-cols-[1fr_110px]' : 'grid-cols-1')}>
              <div>
                <label htmlFor="rep-target" className="label">
                  Target {action === 'remove_impairment' && '(from collected evidence)'}
                </label>
                {options.length ? (
                  <select id="rep-target" className="field font-mono text-[12.5px]" value={target} onChange={(e) => setTarget(e.target.value)} disabled={noDiag}>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">No impairment IDs observed yet — inspect lab impairment rules first.</p>
                )}
              </div>
              {action === 'set_access_vlan' && (
                <div>
                  <label htmlFor="rep-vlan" className="label">
                    VLAN
                  </label>
                  <select id="rep-vlan" className="field font-mono text-[12.5px]" value={vlan} onChange={(e) => setVlan(Number(e.target.value))} disabled={noDiag}>
                    {cat.targets.vlans.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {action === 'set_mtu' && (
                <div>
                  <label htmlFor="rep-mtu" className="label">
                    MTU
                  </label>
                  <input id="rep-mtu" type="number" min={576} max={9216} className="field font-mono text-[12.5px]" value={mtu} onChange={(e) => setMtu(Number(e.target.value))} disabled={noDiag} />
                </div>
              )}
            </div>
            <div>
              <label htmlFor="rep-notes" className="label">
                Change note (optional)
              </label>
              <input id="rep-notes" className="field text-[13px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this change, ticket reference…" disabled={noDiag} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={apply.isPending} disabled={noDiag || !target}>
                Apply corrective action
              </Button>
            </div>
            <InlineError error={apply.error} />
          </form>
        )}
        {inv.repairs.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {inv.repairs.map((r) => (
              <motion.li key={r.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg border border-line bg-white px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-ink">{r.description}</span>
                  <Badge tone={r.outcome === 'state_changed' ? 'accent' : 'neutral'}>{r.outcome === 'state_changed' ? 'changed' : 'no change'}</Badge>
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-faint">
                  {r.id} · {fmtTime(r.applied_at)} {r.notes && `· ${r.notes}`}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="eyebrow mb-2 flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden /> Scenario-specific verification
        </h3>
        <p className="mb-2 text-[12px] leading-relaxed text-muted">Runs every recovery check defined for this scenario and records each result as new evidence. A single ping never passes verification on its own.</p>
        {!closed && (
          <Button variant={inv.repairs.length ? 'primary' : 'secondary'} size="sm" className="w-full" loading={verify.isPending} disabled={!inv.repairs.length} onClick={() => verify.mutate()} icon={<ShieldCheck className="size-3.5" aria-hidden />}>
            Run verification
          </Button>
        )}
        <InlineError error={verify.error} />
        {lastRun && (
          <div className="mt-3">
            <VerificationRunCard key={lastRun.id} run={lastRun} evidence={inv.evidence} />
          </div>
        )}
      </section>

      <section>
        <h3 className="eyebrow mb-2">Resolution criteria</h3>
        <ul className="space-y-1">
          {inv.resolution_criteria.map((c, i) => (
            <motion.li key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }} className="flex items-center gap-2 text-[12.5px]">
              {c.met ? <CheckCircle2 className="size-4 text-ok" aria-hidden /> : <Circle className="size-4 text-line" aria-hidden />}
              <span className={c.met ? 'text-ink' : 'text-muted'}>{c.label}</span>
              <span className="sr-only">{c.met ? 'met' : 'not met'}</span>
            </motion.li>
          ))}
        </ul>
        {inv.status !== 'resolved' && inv.status !== 'abandoned' && (
          <div className="mt-3 space-y-2">
            <label htmlFor="lessons" className="label">
              Lessons learned (your own words — optional)
            </label>
            <textarea id="lessons" rows={2} className="field text-[13px]" value={lessons} onChange={(e) => setLessons(e.target.value)} />
            <Button variant="primary" className="w-full" disabled={!allMet} loading={resolve.isPending} onClick={() => resolve.mutate()} icon={<CheckCircle2 className="size-4" aria-hidden />}>
              Resolve investigation
            </Button>
            {!allMet && <p className="text-center text-[11px] text-muted">Resolve unlocks when every criterion is met.</p>}
            <InlineError error={resolve.error} />
          </div>
        )}
        {inv.status === 'resolved' && (
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-3 rounded-xl border border-[#c6dfd0] bg-ok-soft p-3 text-center">
            <CheckCircle2 className="mx-auto mb-1 size-6 text-ok" aria-hidden />
            <div className="text-[14px] font-semibold text-ok">Resolved with evidence</div>
            {inv.answer_key && (
              <p className="mt-1 text-[12px] text-ink/80">
                Answer key: {inv.answer_key.diagnosis_label} — your diagnosis {inv.answer_key.diagnosis_matched ? 'matched' : 'did not match'}.
              </p>
            )}
            <Link to={`/reports/${inv.id}`} className="mt-2 inline-block">
              <Button size="sm" icon={<FileText className="size-3.5" aria-hidden />}>
                Open report
              </Button>
            </Link>
          </motion.div>
        )}
      </section>

      <section className="border-t border-line-2 pt-4">
        <h3 className="eyebrow mb-2">Drill controls</h3>
        <div className="flex flex-wrap gap-2">
          {inv.status === 'resolved' && (
            <Button size="sm" icon={<Undo2 className="size-3.5" aria-hidden />} loading={reopen.isPending} onClick={() => reopen.mutate()}>
              Reopen
            </Button>
          )}
          {!closed && (
            <Button size="sm" variant="danger" icon={<XOctagon className="size-3.5" aria-hidden />} onClick={() => setConfirm('abandon')}>
              Abandon drill
            </Button>
          )}
          {inv.execution.status !== 'reset' && (
            <Button size="sm" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => setConfirm('reset')}>
              Reset simulation
            </Button>
          )}
          <Button
            size="sm"
            icon={<Repeat className="size-3.5" aria-hidden />}
            loading={restarting}
            onClick={async () => {
              setRestarting(true)
              try {
                const n = await api.restart(inv.id)
                nav(`/investigations/${n.id}`)
              } finally {
                setRestarting(false)
              }
            }}
          >
            Restart as new drill
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Reset and restart never delete history: evidence stays attached to <Mono>{inv.id}</Mono>; other drills are untouched.
        </p>
      </section>

      <Dialog open={confirm === 'abandon'} onOpenChange={(o) => !o && setConfirm(null)} title="Abandon this drill?" description="The investigation is closed without being marked successful. Evidence is preserved.">
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
      </Dialog>
      <Dialog open={confirm === 'reset'} onOpenChange={(o) => !o && setConfirm(null)} title="Reset this simulation?" description={`Restores execution ${inv.execution.id} to the healthy baseline. Only this drill is affected; its evidence is kept. An unresolved drill is closed as abandoned.`}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="primary" loading={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: () => setConfirm(null) })}>
            Reset to baseline
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
