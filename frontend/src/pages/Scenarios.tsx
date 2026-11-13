import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, ChevronDown, Dices, Presentation } from 'lucide-react'
import { Page } from '../components/AppShell'
import { Button, ErrorState, InlineError, PageHeader, Skeleton } from '../components/ui'
import { LinkButton } from '../components/report/LinkButton'
import { api } from '../lib/api'
import { qk, useScenarios } from '../lib/hooks'
import type { ScenarioDef } from '../lib/types'

type Mode = 'guided' | 'challenge'
type StartVars = { key: string; mode: Mode }

export default function Scenarios() {
  const scenarios = useScenarios()
  const lab = useQuery({ queryKey: qk.lab, queryFn: api.lab, staleTime: 30_000, retry: 0 })
  const qc = useQueryClient()
  const nav = useNavigate()
  const { hash } = useLocation()
  const target = decodeURIComponent(hash.replace(/^#/, ''))
  const start = useMutation({
    mutationFn: ({ key, mode }: StartVars) => api.createInvestigation(key, mode),
    onSuccess: (inv) => {
      qc.setQueryData(qk.investigation(inv.id), inv)
      qc.invalidateQueries({ queryKey: qk.investigations })
      nav(`/investigations/${inv.id}`)
    },
  })
  const pendingFor = (key: string, mode: Mode) => start.isPending && start.variables?.key === key && start.variables?.mode === mode
  const randomError = start.isError && start.variables?.key === 'random' ? start.error : null

  // /scenarios#wrong-vlan → bring that scenario into view once the list has rendered.
  const loaded = !!scenarios.data
  useEffect(() => {
    if (!loaded || !target) return
    const raf = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(raf)
  }, [loaded, target])

  return (
    <Page>
      <PageHeader
        title="Scenarios"
        description="Fault drills on the documented two-rack lab. Guided runs show hints; challenges hide the scenario until you resolve it."
        actions={
          <div className="flex shrink-0 items-center gap-2">
            <LinkButton to="/present" variant="ghost" icon={<Presentation className="size-4" aria-hidden />}>
              Guided walkthrough
            </LinkButton>
            <Button icon={<Dices className="size-4" aria-hidden />} loading={pendingFor('random', 'challenge')} disabled={start.isPending && !pendingFor('random', 'challenge')} onClick={() => start.mutate({ key: 'random', mode: 'challenge' })}>
              Random challenge
            </Button>
          </div>
        }
      />
      {randomError && (
        <div className="-mt-3 mb-5">
          <InlineError error={randomError} />
        </div>
      )}

      {scenarios.isPending ? (
        <div className="panel divide-y divide-line-2" role="status" aria-live="polite">
          <span className="sr-only">Loading scenarios…</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-5 py-5">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <Skeleton className="h-9 w-40" />
            </div>
          ))}
        </div>
      ) : scenarios.isError ? (
        <ErrorState error={scenarios.error} onRetry={() => scenarios.refetch()} />
      ) : (
        <ul className="panel divide-y divide-line" aria-label="Scenarios">
          {scenarios.data.scenarios.map((s) => (
            <ScenarioItem
              key={s.key}
              s={s}
              targeted={s.key === target}
              labReady={!!lab.data?.available}
              pending={(m) => pendingFor(s.key, m)}
              busy={start.isPending}
              error={start.isError && start.variables?.key === s.key ? start.error : null}
              onStart={(mode) => start.mutate({ key: s.key, mode })}
            />
          ))}
        </ul>
      )}
    </Page>
  )
}

function ScenarioItem({ s, targeted, labReady, pending, busy, error, onStart }: { s: ScenarioDef; targeted: boolean; labReady: boolean; pending: (m: Mode) => boolean; busy: boolean; error: unknown; onStart: (m: Mode) => void }) {
  const [open, setOpen] = useState(false)
  const panelId = `scn-details-${s.key}`
  return (
    <li id={s.key} className={clsx('scroll-mt-6 first:rounded-t-lg last:rounded-b-lg', targeted && 'bg-accent-soft/40')}>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 md:flex-row md:items-center md:gap-8">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15.5px] font-semibold tracking-tight text-ink">{s.title}</h2>
          <p className="mt-0.5 text-[14px] leading-snug text-muted">{s.short}</p>
          <ModeTags modes={s.modes} labReady={labReady} difficulty={s.difficulty} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" loading={pending('guided')} disabled={busy && !pending('guided')} onClick={() => onStart('guided')}>
            Start investigation
          </Button>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
          >
            Details
            <ChevronDown className={clsx('size-4 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
          </button>
        </div>
      </div>
      {error ? (
        <div className="-mt-2 px-4 pb-4 sm:px-5">
          <InlineError error={error} />
        </div>
      ) : null}
      {open && (
        <div id={panelId} className="border-t border-line-2 px-4 pb-5 pt-4 sm:px-5">
          <Details s={s} pending={pending('challenge')} disabled={busy && !pending('challenge')} onChallenge={() => onStart('challenge')} />
        </div>
      )}
    </li>
  )
}

function ModeTags({ modes, labReady, difficulty }: { modes: string[]; labReady: boolean; difficulty?: string }) {
  const tags: { label: string; title?: string }[] = []
  if (modes.includes('SIMULATED')) tags.push({ label: 'Simulation', title: 'Runs on the deterministic simulation model.' })
  if (modes.includes('LINUX_LAB'))
    tags.push({
      label: 'Linux lab (optional)',
      title: labReady ? 'Linux lab runner is configured and reachable.' : 'Optional. Disabled until the Linux lab runner is configured in Settings.',
    })
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
      {tags.map((t) => (
        <span key={t.label} title={t.title} className="rounded border border-line px-1.5 py-px text-muted">
          {t.label}
        </span>
      ))}
      {difficulty && <span className="ml-1 text-faint">{difficulty}</span>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-[12.5px] font-medium text-muted">{label}</dt>
      <dd className="min-w-0 text-[13.5px] leading-relaxed text-ink">{children}</dd>
    </div>
  )
}

function List({ items }: { items?: string[] }) {
  if (!items?.length) return <span className="text-muted">—</span>
  return (
    <ul className="list-disc space-y-0.5 pl-4 marker:text-faint">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  )
}

function Details({ s, pending, disabled, onChallenge }: { s: ScenarioDef; pending: boolean; disabled: boolean; onChallenge: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Button size="sm" loading={pending} disabled={disabled} onClick={onChallenge}>
          Start as challenge
        </Button>
        <p className="text-[12.5px] text-muted">Hides the scenario name, hints and answer key until you resolve or abandon.</p>
      </div>

      <dl className="divide-y divide-line-2 border-y border-line-2">
        {s.learning_objective && <Row label="Learning objective">{s.learning_objective}</Row>}
        <Row label="Symptom report">{s.symptom_report}</Row>
      </dl>

      <p className="flex items-start gap-2 text-[12.5px] text-warn">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Spoilers below: the fault, how to confirm it and how to fix it. Stop here for a blind drill.
      </p>

      <dl className="divide-y divide-line-2 border-y border-line-2">
        <Row label="Observable symptoms">
          <List items={s.observable_symptoms} />
        </Row>
        <Row label="Alternative causes">
          <List items={s.alternative_causes} />
        </Row>
        <Row label="Expected evidence">
          <List items={s.expected_evidence} />
        </Row>
        <Row label="Available tests">
          <span className="flex flex-wrap gap-1">
            {(s.available_tests ?? []).map((t) => (
              <code key={t} className="rounded bg-canvas px-1.5 py-px font-mono text-[11.5px] text-ink">
                {t}
              </code>
            ))}
          </span>
        </Row>
        <Row label="Fault">{s.fault_mutation ?? '—'}</Row>
        <Row label="Corrective action">{s.corrective_action ?? '—'}</Row>
        <Row label="Recovery checks">
          <ol className="space-y-1.5">
            {(s.recovery_checks ?? []).map((c, i) => (
              <li key={c.id} className="flex gap-2">
                <span className="tnum w-4 shrink-0 font-mono text-[12px] text-faint">{i + 1}.</span>
                <span className="min-w-0">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-muted"> — {c.rationale}</span>
                </span>
              </li>
            ))}
          </ol>
        </Row>
        <Row label="Baseline">{s.baseline}</Row>
        <Row label="Reset">{s.reset_behavior}</Row>
        {s.note && <Row label="Note">{s.note}</Row>}
        {s.safety && (
          <Row label="Optical safety">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-1 size-3.5 shrink-0 text-crit" aria-hidden />
              {s.safety}
            </span>
          </Row>
        )}
      </dl>
    </div>
  )
}
