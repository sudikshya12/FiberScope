import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import { ArrowRight, CheckCircle2, ChevronRight, ExternalLink, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { Page } from '../components/AppShell'
import { Badge, Button, ErrorState, InlineError, LoadingBlock, PageHeader, SourceBadge } from '../components/ui'
import { CodeBlock } from '../components/overview/bits'
import { api, ApiError } from '../lib/api'
import { qk, useProfile } from '../lib/hooks'
import { fmtDate } from '../lib/format'
import type { Profile } from '../lib/types'

const PLACEHOLDER_PROFILE: Profile = {
  name: 'Your Name',
  target_role: 'Data Center Operations Technician',
  summary: 'Edit this in Settings → Candidate profile. Describe your own background here — FiberScope never invents experience.',
  links: [],
}

const LIMITS = { name: 120, role: 160, summary: 4000, links: 8, label: 80, url: 500 }

// ---------------------------------------------------------------- layout pieces

const M = ({ children }: { children: ReactNode }) => <code className="rounded bg-canvas px-1 py-px font-mono text-[12.5px] text-ink">{children}</code>

function Section({ id, title, description, actions, children }: { id: string; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 border-t border-line pt-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[18px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Native disclosure with a rotating chevron; content stays mounted so form state survives collapsing. */
function Disclosure({ open, onOpenChange, summary, note, children, id }: { open: boolean; onOpenChange: (o: boolean) => void; summary: ReactNode; note?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <details id={id} open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)} className="group scroll-mt-6 rounded-md border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-md px-3.5 py-3 outline-none hover:bg-stage focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-ink">{summary}</span>
          {note && <span className="mt-0.5 block text-[12.5px] text-muted">{note}</span>}
        </span>
      </summary>
      <div className="border-t border-line-2 px-3.5 py-4">{children}</div>
    </details>
  )
}

function Row({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[13.5px]">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-right text-ink">{children}</dd>
    </div>
  )
}

function Bool({ v }: { v: boolean }) {
  return <span className={clsx('font-mono text-[12.5px] font-semibold', v ? 'text-ok' : 'text-muted')}>{v ? 'yes' : 'no'}</span>
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2 text-[13.5px] font-medium text-ink">
        <span className="w-4 shrink-0 font-mono text-[12px] text-faint" aria-hidden>
          {n}.
        </span>
        {title}
      </div>
      {children}
    </li>
  )
}

// ---------------------------------------------------------------- lab mode

function LabMode({ stepsOpen, setStepsOpen }: { stepsOpen: boolean; setStepsOpen: (o: boolean) => void }) {
  const lab = useQuery({ queryKey: qk.lab, queryFn: api.lab, staleTime: 30_000, retry: 0 })
  const s = lab.data
  const state = s ? (s.available ? 'ready' : s.enabled ? 'not_ready' : 'disabled') : null
  return (
    <Section
      id="lab-mode"
      title="Lab mode"
      description="Where evidence comes from. Simulation is always available; the Linux lab is optional."
      actions={
        <Button size="sm" variant="ghost" onClick={() => lab.refetch()} loading={lab.isFetching} icon={<RefreshCw className="size-3.5" aria-hidden />}>
          Refresh status
        </Button>
      }
    >
      <div className="divide-y divide-line-2 rounded-md border border-line bg-panel">
        {/* Simulation */}
        <div className="grid gap-x-6 gap-y-2 px-4 py-3.5 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
          <div>
            <div className="text-[14.5px] font-semibold text-ink">Simulation</div>
            <div className="text-[12.5px] text-muted">Default · no privileges</div>
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted">
            Deterministic model of the North Lab Fabric, labeled <SourceBadge mode="SIMULATED" className="mx-0.5 align-middle" />. All five scenarios. Runs on macOS, Windows or Linux.
          </p>
          <div className="sm:text-right">
            <Badge tone="accent">
              <CheckCircle2 className="size-3" aria-hidden /> ACTIVE
            </Badge>
          </div>
        </div>

        {/* Linux lab */}
        <div className="grid gap-x-6 gap-y-2 px-4 py-3.5 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
          <div>
            <div className="text-[14.5px] font-semibold text-ink">Linux lab</div>
            <div className="text-[12.5px] text-muted">Optional · Linux only</div>
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] leading-relaxed text-muted">Isolated namespaces, veth pairs and VLAN-aware bridges via a separate privileged runner. No physical optics — the low-Rx scenario stays simulation-only.</p>
            <div className="mt-2" role="status" aria-live="polite">
              {lab.isLoading ? (
                <LoadingBlock rows={2} label="Loading lab status" />
              ) : lab.error ? (
                <ErrorState error={lab.error} onRetry={() => lab.refetch()} />
              ) : s ? (
                <dl className="max-w-md divide-y divide-line-2">
                  <Row k="Enabled (backend env)">
                    <Bool v={s.enabled} />
                  </Row>
                  <Row k="Runner available">
                    <Bool v={s.available} />
                  </Row>
                  <Row k="Token configured">
                    <Bool v={s.token_configured} />
                  </Row>
                  <Row k="Runner URL">
                    <span className="font-mono text-[12.5px]">{s.runner_url}</span>
                  </Row>
                  {s.reason && (
                    <div className="py-1.5 text-[12.5px] leading-relaxed text-muted">
                      <span className="font-medium text-ink">Reason: </span>
                      {s.reason}
                    </div>
                  )}
                </dl>
              ) : null}
            </div>
          </div>
          <div className="sm:text-right">
            {state && <Badge tone={state === 'ready' ? 'ok' : state === 'not_ready' ? 'warn' : 'neutral'}>{state === 'ready' ? 'READY' : state === 'not_ready' ? 'NOT READY' : 'DISABLED'}</Badge>}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Disclosure id="linux-lab" open={stepsOpen} onOpenChange={setStepsOpen} summary="Enable the Linux lab" note="Five steps in a Linux VM or host. Requires root for the runner.">
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-muted">
            Activation is deliberate on both sides: the runner needs root, <M>FIBERSCOPE_LAB_ENABLE=1</M> and <M>--i-understand</M>; the API needs <M>FIBERSCOPE_LINUX_LAB_ENABLED=1</M> and the shared token. On macOS or Windows, run both inside a Linux VM.
          </p>
          <ol className="mt-4 grid gap-4">
            <Step n={1} title="Check the environment and create the lab">
              <CodeBlock title="runner · check & setup" code={'sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py check\nsudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py setup --i-understand'} />
            </Step>
            <Step n={2} title="Create a token file (≥ 32 characters, mode 0600)">
              <CodeBlock title="token" code={'sudo install -d -m 700 /etc/fiberscope-lab\nopenssl rand -hex 32 | sudo tee /etc/fiberscope-lab/token >/dev/null\nsudo chmod 600 /etc/fiberscope-lab/token'} />
            </Step>
            <Step n={3} title="Serve on loopback (127.0.0.1:8765)">
              <CodeBlock title="runner · serve" code={'sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py serve --token-file /etc/fiberscope-lab/token --i-understand'} />
            </Step>
            <Step n={4} title="Start the API with the lab enabled">
              <CodeBlock title="backend" code={'cd backend\nFIBERSCOPE_LINUX_LAB_ENABLED=1 FIBERSCOPE_LAB_RUNNER_TOKEN="$(sudo cat /etc/fiberscope-lab/token)" uv run uvicorn app.main:app --port 8077'} />
            </Step>
            <Step n={5} title="Tear down when finished">
              <CodeBlock title="runner · teardown" code={'sudo FIBERSCOPE_LAB_ENABLE=1 python3 labrunner/fiberscope_labrunner.py teardown --i-understand'} />
            </Step>
          </ol>
          <div className="mt-5 border-t border-line-2 pt-4">
            <h3 className="text-[13.5px] font-semibold text-ink">What the runner will and won’t touch</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
              {[
                <>Acts only on <M>fslab-*</M> namespaces it created and recorded; every lab link is tagged as FiberScope-owned.</>,
                'Never touches host interfaces, the default route, DNS or the firewall.',
                'Fixed, allowlisted actions built as argv lists — no shell, no free-form commands; bounded timeouts and output.',
                'Listens on 127.0.0.1 only; bearer token with constant-time comparison; JSONL audit log.',
                <>Optional <M>FIBERSCOPE_LAB_RUNNER_URL</M> overrides the default runner address.</>,
              ].map((t, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" aria-hidden />
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </Disclosure>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- profile

type Errors = Partial<Record<'name' | 'target_role' | 'summary' | 'links', string>> & { link?: Record<number, { label?: string; url?: string }> }

function validate(p: Profile): Errors {
  const e: Errors = {}
  if (!p.name.trim()) e.name = 'Name is required.'
  else if (p.name.length > LIMITS.name) e.name = `Keep it under ${LIMITS.name} characters.`
  if (p.target_role.length > LIMITS.role) e.target_role = `Keep it under ${LIMITS.role} characters.`
  if (p.summary.length > LIMITS.summary) e.summary = `Keep it under ${LIMITS.summary} characters.`
  if (p.links.length > LIMITS.links) e.links = `At most ${LIMITS.links} links.`
  p.links.forEach((l, i) => {
    const le: { label?: string; url?: string } = {}
    if (!l.label.trim()) le.label = 'Label is required.'
    else if (l.label.length > LIMITS.label) le.label = `Keep it under ${LIMITS.label} characters.`
    const url = l.url.trim()
    if (!url) le.url = 'URL is required.'
    else if (!/^(https?:\/\/|mailto:)/i.test(url)) le.url = 'Use an http://, https:// or mailto: URL.'
    else {
      try {
        new URL(url)
      } catch {
        le.url = 'This is not a valid URL.'
      }
    }
    if (le.label || le.url) (e.link ??= {})[i] = le
  })
  return e
}

const hasErrors = (e: Errors) => Object.keys(e).some((k) => (k === 'link' ? Object.keys(e.link ?? {}).length > 0 : !!e[k as keyof Errors]))

function serverFieldErrors(err: unknown): Errors {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {}
  const out: Errors = {}
  for (const d of err.details as { loc?: (string | number)[]; msg?: string }[]) {
    const loc = (d.loc ?? []).filter((x) => x !== 'body')
    const f = loc[0]
    if (f === 'name' || f === 'target_role' || f === 'summary') out[f] = d.msg ?? 'Invalid value.'
    else if (f === 'links') {
      if (typeof loc[1] === 'number') (out.link ??= {})[loc[1]] = { url: d.msg ?? 'Invalid link.' }
      else out.links = d.msg ?? 'Invalid links.'
    }
  }
  return out
}

function FieldMsg({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error)
    return (
      <p id={id} className="mt-1 text-[12.5px] text-crit">
        {error}
      </p>
    )
  if (hint)
    return (
      <p id={id} className="mt-1 text-[12px] text-faint">
        {hint}
      </p>
    )
  return null
}

function ProfileForm({ initial, onSaved }: { initial: Profile; onSaved: (p: Profile) => void }) {
  const uid = useId()
  const [form, setForm] = useState<Profile>({ name: initial.name, target_role: initial.target_role, summary: initial.summary, links: initial.links.map((l) => ({ label: l.label ?? '', url: l.url ?? '' })) })
  const [touched, setTouched] = useState(false)
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: (p: Profile) => api.saveProfile(p),
    onSuccess: (p) => {
      qc.setQueryData(qk.profile, p)
      onSaved(p)
    },
  })

  const clientErrors = validate(form)
  const errors: Errors = touched ? clientErrors : {}
  const serverErrors = save.error ? serverFieldErrors(save.error) : {}
  const merged: Errors = { ...serverErrors, ...errors, link: { ...(serverErrors.link ?? {}), ...(errors.link ?? {}) } }
  const dirty = JSON.stringify({ ...form, links: form.links }) !== JSON.stringify({ name: initial.name, target_role: initial.target_role, summary: initial.summary, links: initial.links })
  const isPlaceholder = JSON.stringify({ ...form }) === JSON.stringify(PLACEHOLDER_PROFILE)

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (save.isError) save.reset()
  }
  const setLink = (i: number, k: 'label' | 'url', v: string) => set('links', form.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (hasErrors(clientErrors)) {
      // aria-invalid is applied on the next render
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-form="${uid}"] [aria-invalid="true"]`)?.focus())
      return
    }
    save.mutate({ name: form.name.trim(), target_role: form.target_role.trim(), summary: form.summary, links: form.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })) })
  }

  const ids = { name: `${uid}-name`, role: `${uid}-role`, summary: `${uid}-summary` }
  const generalError = save.error && !hasErrors(serverErrors) ? save.error : null

  return (
    <form onSubmit={submit} noValidate data-form={uid} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={ids.name} className="label">
            Name <span className="text-crit" aria-hidden>*</span>
          </label>
          <input id={ids.name} className={clsx('field', merged.name && 'border-crit')} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={LIMITS.name + 20} required aria-invalid={!!merged.name} aria-describedby={`${ids.name}-m`} autoComplete="name" />
          <FieldMsg id={`${ids.name}-m`} error={merged.name} hint="Stored locally. Not shown in the main interface." />
        </div>
        <div>
          <label htmlFor={ids.role} className="label">
            Target role
          </label>
          <input id={ids.role} className={clsx('field', merged.target_role && 'border-crit')} value={form.target_role} onChange={(e) => set('target_role', e.target.value)} aria-invalid={!!merged.target_role} aria-describedby={`${ids.role}-m`} autoComplete="organization-title" />
          <FieldMsg id={`${ids.role}-m`} error={merged.target_role} />
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor={ids.summary} className="label">
            Summary
          </label>
          <span className={clsx('font-mono text-[11px]', form.summary.length > LIMITS.summary ? 'text-crit' : 'text-faint')}>
            {form.summary.length}/{LIMITS.summary}
          </span>
        </div>
        <textarea id={ids.summary} rows={5} className={clsx('field resize-y leading-relaxed', merged.summary && 'border-crit')} value={form.summary} onChange={(e) => set('summary', e.target.value)} aria-invalid={!!merged.summary} aria-describedby={`${ids.summary}-m`} />
        <FieldMsg id={`${ids.summary}-m`} error={merged.summary} hint="Your own words about your own background." />
      </div>

      <fieldset>
        <legend className="label flex w-full items-center justify-between">
          <span>
            Links <span className="text-faint">({form.links.length}/{LIMITS.links})</span>
          </span>
        </legend>
        {form.links.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-[13px] text-muted">No links yet — add a portfolio, repository or contact link (http, https or mailto).</p>}
        <ul className="space-y-2.5">
          <AnimatePresence initial={false}>
            {form.links.map((l, i) => {
              const le = merged.link?.[i] ?? {}
              const lid = `${uid}-link-${i}`
              return (
                <motion.li key={i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="grid gap-2 rounded-md border border-line-2 bg-stage p-2.5 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] sm:items-start">
                    <div>
                      <label htmlFor={`${lid}-label`} className="label">
                        Label
                      </label>
                      <input id={`${lid}-label`} className={clsx('field', le.label && 'border-crit')} value={l.label} placeholder="e.g. GitHub" onChange={(e) => setLink(i, 'label', e.target.value)} aria-invalid={!!le.label} aria-describedby={`${lid}-label-m`} />
                      <FieldMsg id={`${lid}-label-m`} error={le.label} />
                    </div>
                    <div>
                      <label htmlFor={`${lid}-url`} className="label">
                        URL
                      </label>
                      <input id={`${lid}-url`} type="url" inputMode="url" className={clsx('field font-mono text-[13px]', le.url && 'border-crit')} value={l.url} placeholder="https://…" onChange={(e) => setLink(i, 'url', e.target.value)} aria-invalid={!!le.url} aria-describedby={`${lid}-url-m`} />
                      <FieldMsg id={`${lid}-url-m`} error={le.url} />
                    </div>
                    <div className="sm:pt-[22px]">
                      <Button type="button" variant="ghost" size="md" onClick={() => set('links', form.links.filter((_, j) => j !== i))} aria-label={`Remove link ${i + 1}${l.label ? ` (${l.label})` : ''}`} icon={<Trash2 className="size-4" aria-hidden />}>
                        <span className="sm:sr-only">Remove</span>
                      </Button>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
        {merged.links && <p className="mt-1 text-[12.5px] text-crit">{merged.links}</p>}
        <Button type="button" size="sm" className="mt-2.5" onClick={() => set('links', [...form.links, { label: '', url: '' }])} disabled={form.links.length >= LIMITS.links} icon={<Plus className="size-3.5" aria-hidden />}>
          Add link
        </Button>
      </fieldset>

      <InlineError error={generalError} />

      <div className="flex flex-wrap items-center gap-2 border-t border-line-2 pt-4">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty && !save.isError} icon={<CheckCircle2 className="size-4" aria-hidden />}>
          Save profile
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setForm({ name: initial.name, target_role: initial.target_role, summary: initial.summary, links: initial.links })
            setTouched(false)
            save.reset()
          }}
          icon={<RotateCcw className="size-3.5" aria-hidden />}
        >
          Discard changes
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isPlaceholder || save.isPending}
          onClick={() => {
            setForm({ ...PLACEHOLDER_PROFILE, links: [] })
            setTouched(false)
          }}
          title="Fill the form with the default placeholders (not saved until you press Save)"
        >
          Use placeholders
        </Button>
        {dirty && !save.isPending && <span className="text-[12.5px] text-muted">Unsaved changes</span>}
      </div>
    </form>
  )
}

function PortfolioProfile({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const profile = useProfile()
  const [savedAt, setSavedAt] = useState<string | null>(null)
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(null), 6000)
    return () => clearTimeout(t)
  }, [savedAt])
  return (
    <section aria-label="Portfolio profile" className="border-t border-line pt-6">
      <Disclosure id="profile" open={open} onOpenChange={setOpen} summary="Portfolio profile (optional)" note="Not shown in the main interface">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted">Write your own details. FiberScope never generates or edits profile content.</p>
          {profile.data?.updated_at && <span className="text-[12px] text-faint">Last saved {fmtDate(profile.data.updated_at)}</span>}
        </div>
        <div aria-live="polite" role="status">
          <AnimatePresence>
            {savedAt && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-4 flex items-center gap-2 rounded-md border border-ok/20 bg-ok-soft px-3 py-2 text-[13px] font-medium text-ok">
                <CheckCircle2 className="size-4" aria-hidden />
                Profile saved · {fmtDate(savedAt)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {profile.isLoading ? (
          <LoadingBlock rows={5} label="Loading profile" />
        ) : profile.error ? (
          <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
        ) : (
          <ProfileForm key={profile.data?.updated_at ?? 'new'} initial={profile.data ?? PLACEHOLDER_PROFILE} onSaved={(p) => setSavedAt(p.updated_at ?? new Date().toISOString())} />
        )}
      </Disclosure>
    </section>
  )
}

// ---------------------------------------------------------------- about

function AboutInstallation() {
  return (
    <Section id="about" title="About">
      <div className="grid gap-x-10 gap-y-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <dl className="min-w-0 divide-y divide-line-2 border-y border-line-2">
          <Row k="Version">
            <span className="font-mono text-[12.5px]">0.1.0</span>
          </Row>
          <Row k="Default source">
            <SourceBadge mode="SIMULATED" />
          </Row>
          <Row k="Environment">North Lab Fabric (fictional)</Row>
          <Row k="Data location">
            <span className="break-all font-mono text-[12.5px]">backend/data/fiberscope.db</span>
          </Row>
          <Row k="API reference">
            <a href="http://127.0.0.1:8077/docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12.5px] text-accent-strong hover:underline">
              127.0.0.1:8077/docs <ExternalLink className="size-3" aria-hidden />
            </a>
          </Row>
        </dl>
        <div className="min-w-0 text-[13.5px] leading-relaxed text-muted">
          <p>Source modes, model limitations, architecture and how to run FiberScope locally.</p>
          <Link to="/about" className="mt-2 inline-flex items-center gap-1.5 font-medium text-accent-strong hover:underline">
            About & Documentation <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <p className="mt-3 text-[12.5px]">
            SQLite, migrated with Alembic on startup. Override with <M>FIBERSCOPE_DATABASE_URL</M>.
          </p>
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------- page

export default function SettingsPage() {
  const loc = useLocation()
  const [profileOpen, setProfileOpen] = useState(loc.hash === '#profile')
  const [stepsOpen, setStepsOpen] = useState(loc.hash === '#linux-lab')
  useEffect(() => {
    if (!loc.hash) return
    const id = loc.hash.slice(1)
    if (id === 'profile') setProfileOpen(true)
    if (id === 'linux-lab') setStepsOpen(true)
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 120)
    return () => clearTimeout(t)
  }, [loc.hash])
  return (
    <Page>
      <div className="max-w-[920px]">
        <PageHeader title="Settings" description="Lab mode, an optional profile, and installation details." />
        <div className="space-y-8">
          <LabMode stepsOpen={stepsOpen} setStepsOpen={setStepsOpen} />
          <PortfolioProfile open={profileOpen} setOpen={setProfileOpen} />
          <AboutInstallation />
        </div>
      </div>
    </Page>
  )
}
