import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, ClipboardCheck, Plus } from 'lucide-react'
import type { Evidence, Investigation } from '../../lib/types'
import { api } from '../../lib/api'
import { useInvMutation } from '../../lib/hooks'
import { Badge, Button, InlineError, VerdictBadge } from '../ui'

export function EvidencePicker({ evidence, value, onChange, label, max = 8 }: { evidence: Evidence[]; value: string[]; onChange: (v: string[]) => void; label: string; max?: number }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      {evidence.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[12px] text-muted">No investigation evidence yet — run diagnostics first.</p>
      ) : (
        <div className="scroll-thin max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
          {evidence.map((e) => {
            const on = value.includes(e.id)
            return (
              <label key={e.id} className={clsx('flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors', on ? 'bg-accent-soft' : 'hover:bg-canvas')}>
                <input type="checkbox" className="mt-0.5 size-3.5 accent-[#6941C6]" checked={on} disabled={!on && value.length >= max} onChange={(ev) => onChange(ev.target.checked ? [...value, e.id] : value.filter((x) => x !== e.id))} />
                <span className="min-w-0 flex-1">
                  <span className="mr-1 font-mono text-[10.5px] text-faint">{e.id}</span>
                  <span className="text-ink">{e.title}</span>
                </span>
                <VerdictBadge verdict={e.verdict} />
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

function NoteField({ inv, field, label, placeholder }: { inv: Investigation; field: 'symptom' | 'scope'; label: string; placeholder: string }) {
  const [v, setV] = useState(inv[field])
  const [saved, setSaved] = useState(false)
  useEffect(() => setV(inv[field]), [inv, field])
  const m = useInvMutation(inv.id, (val: string) => api.notes(inv.id, { [field]: val }))
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={`note-${field}`} className="label">
          {label}
        </label>
        <AnimatePresence>
          {saved && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[11px] text-ok">
              Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <textarea
        id={`note-${field}`}
        rows={2}
        className="field resize-y text-[13px]"
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v !== inv[field])
            m.mutate(v, {
              onSuccess: () => {
                setSaved(true)
                setTimeout(() => setSaved(false), 1500)
              },
            })
        }}
      />
    </div>
  )
}

const HYP_TONE = { open: 'neutral', supported: 'accent', refuted: 'crit', confirmed: 'ok' } as const

export function CasePanel({ inv }: { inv: Investigation }) {
  const invEvidence = inv.evidence.filter((e) => e.phase === 'investigation')
  const closed = inv.status === 'resolved' || inv.status === 'abandoned'
  const [stmt, setStmt] = useState('')
  const [sup, setSup] = useState<string[]>([])
  const [con, setCon] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const addH = useInvMutation(inv.id, () => api.addHypothesis(inv.id, stmt, sup, con))
  const updH = useInvMutation(inv.id, ({ hid, status }: { hid: string; status: string }) => api.updateHypothesis(inv.id, hid, { status }))
  const [cat, setCat] = useState(inv.diagnosis_category ?? '')
  const [diag, setDiag] = useState(inv.diagnosis ?? '')
  const [cite, setCite] = useState<string[]>(inv.diagnosis_evidence_ids ?? [])
  const rec = useInvMutation(inv.id, () => api.diagnosis(inv.id, cat, diag, cite))
  const faulted = inv.execution.status === 'faulted'

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="eyebrow">Problem statement</h3>
        <NoteField inv={inv} field="symptom" label="Symptom" placeholder="What was reported or observed?" />
        <NoteField inv={inv} field="scope" label="Scope" placeholder="Who/what is affected? What still works?" />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="eyebrow">Hypotheses</h3>
          {!closed && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              Add
            </Button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {adding && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-3 space-y-2 overflow-hidden rounded-lg border border-line bg-canvas/60 p-2.5"
              onSubmit={(e) => {
                e.preventDefault()
                addH.mutate(undefined, {
                  onSuccess: () => {
                    setStmt('')
                    setSup([])
                    setCon([])
                    setAdding(false)
                  },
                })
              }}
            >
              <label htmlFor="hyp-stmt" className="label">
                Hypothesis
              </label>
              <input id="hyp-stmt" className="field text-[13px]" placeholder="e.g. Physical link to Server B is down" value={stmt} onChange={(e) => setStmt(e.target.value)} required />
              <EvidencePicker evidence={invEvidence} value={sup} onChange={setSup} label="Supporting evidence" />
              <EvidencePicker evidence={invEvidence} value={con} onChange={setCon} label="Contradicting evidence" />
              <div className="flex justify-end">
                <Button type="submit" size="sm" variant="primary" loading={addH.isPending} disabled={!stmt.trim()}>
                  Save hypothesis
                </Button>
              </div>
              <InlineError error={addH.error} />
            </motion.form>
          )}
        </AnimatePresence>
        {inv.hypotheses.length === 0 ? (
          <p className="text-[12.5px] text-muted">No hypotheses yet. Write down what you think is wrong, then cite evidence for and against it.</p>
        ) : (
          <ul className="space-y-2">
            {inv.hypotheses.map((h) => (
              <motion.li layout key={h.id} className="rounded-lg border border-line bg-white p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className={clsx('text-[13px] text-ink', h.status === 'refuted' && 'text-muted line-through')}>{h.statement}</p>
                  <Badge tone={HYP_TONE[h.status]} className="uppercase">
                    {h.status}
                  </Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1 text-[10.5px]">
                  {h.supporting_evidence_ids.map((id) => (
                    <span key={id} className="rounded bg-ok-soft px-1 font-mono text-ok">
                      + {id}
                    </span>
                  ))}
                  {h.contradicting_evidence_ids.map((id) => (
                    <span key={id} className="rounded bg-crit-soft px-1 font-mono text-crit">
                      − {id}
                    </span>
                  ))}
                </div>
                {!closed && (
                  <div className="mt-2 flex gap-1">
                    {(['supported', 'refuted', 'confirmed'] as const).map((s) => (
                      <button key={s} type="button" onClick={() => updH.mutate({ hid: h.id, status: s })} className={clsx('rounded-md border px-1.5 py-0.5 text-[11px] capitalize transition-colors', h.status === s ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line text-muted hover:text-ink')}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </motion.li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="eyebrow mb-2">Diagnosis</h3>
        {inv.diagnosis && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mb-3 rounded-lg border border-nav/15 bg-nav p-3 text-white">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#cfc9d6]">
              <ClipboardCheck className="size-3.5" aria-hidden /> Recorded diagnosis
            </div>
            <div className="text-[13px] font-semibold">{inv.diagnosis_categories[inv.diagnosis_category ?? ''] ?? inv.diagnosis_category}</div>
            <p className="mt-0.5 text-[12.5px] text-white/80">{inv.diagnosis}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {inv.diagnosis_evidence_ids.map((id) => (
                <span key={id} className="rounded bg-white/10 px-1 font-mono text-[10.5px] text-white/85">
                  {id}
                </span>
              ))}
            </div>
          </motion.div>
        )}
        {!closed && (
          <form
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              rec.mutate()
            }}
          >
            {!faulted && <p className="rounded-lg bg-canvas px-3 py-2 text-[12px] text-muted">A diagnosis can be recorded once the scenario fault has been introduced and evidence collected.</p>}
            <div>
              <label htmlFor="diag-cat" className="label">
                Category
              </label>
              <select id="diag-cat" className="field text-[13px]" value={cat} onChange={(e) => setCat(e.target.value)} required>
                <option value="">Select…</option>
                {Object.entries(inv.diagnosis_categories).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="diag-stmt" className="label">
                Statement — what is wrong, where, and what the evidence shows
              </label>
              <textarea id="diag-stmt" rows={3} className="field text-[13px]" value={diag} onChange={(e) => setDiag(e.target.value)} required placeholder="e.g. asw-2 Ethernet1/1 runs access VLAN 30; intended VLAN 20. Link is up at both ends; ARP from Server A fails." />
            </div>
            <EvidencePicker evidence={invEvidence} value={cite} onChange={setCite} label="Cite evidence (required)" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">{cite.length} cited</span>
              <Button type="submit" variant="primary" size="sm" loading={rec.isPending} disabled={!faulted || !cat || !diag.trim() || !cite.length} icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
                {inv.diagnosis ? 'Update diagnosis' : 'Record diagnosis'}
              </Button>
            </div>
            <InlineError error={rec.error} />
          </form>
        )}
      </section>
    </div>
  )
}
