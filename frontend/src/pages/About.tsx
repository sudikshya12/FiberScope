import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { Page } from '../components/AppShell'
import { Badge, SourceBadge } from '../components/ui'
import { ArchitectureDiagram } from '../components/overview/ArchitectureDiagram'
import { CodeBlock } from '../components/overview/bits'
import { api } from '../lib/api'
import { qk } from '../lib/hooks'

// ---------------------------------------------------------------- content

const SECTIONS = [
  { id: 'source-modes', title: 'Source modes' },
  { id: 'limitations', title: 'Model limitations' },
  { id: 'real-vs-simulated', title: 'Real vs simulated' },
  { id: 'architecture', title: 'Architecture' },
  { id: 'run-locally', title: 'Run locally' },
  { id: 'docs', title: 'Full documentation' },
] as const

const LIMITATIONS: ReactNode[] = [
  <>Device output imitates a <em>generic</em> switch CLI and Linux tools — not any vendor’s exact format.</>,
  <>Optical readings come from a power-budget model (attenuation × length, 0.3 dB per mated pair, modeled contamination). Thresholds are fixture values; loss figures are estimates, not OTDR or light-meter measurements.</>,
  <>Throughput and RTT use simplified models with seeded jitter — not TCP predictions.</>,
  <>Connector inspection, cleaning and replacement are recorded procedures in simulation; nothing physical happens.</>,
  <>MTU is modeled as L3 MTU on every hop. One fabric (North Lab Fabric); scenarios are defined in code.</>,
  <>The Linux lab is unit-tested at its safety boundary but <strong>not live-validated</strong>. veth links have no optics, and veth throughput reflects CPU.</>,
  <>Simulated network time is separate from wall-clock time. Baseline comparisons are single runs (n = 1). No MTTD claims.</>,
  <>Single user, no authentication — intended for localhost. Imported evidence supports one format and is range-checked only.</>,
]

type Row = { cap: string; sim: string; lab: string; hw: string; labNone?: boolean }
const CAPS: Row[] = [
  { cap: 'Topology', sim: 'Seeded inventory model', lab: 'Namespaces, veth pairs and VLAN-aware bridges mirror it', hw: 'Real racks, servers, switches' },
  { cap: 'Device output', sim: 'Generated, deterministic', lab: 'Real ip / bridge / tc / ping output (Linux, not a switch OS)', hw: 'Vendor switch CLI and NOS' },
  { cap: 'VLAN, admin, MTU, loss faults', sim: 'Modeled state changes', lab: 'Real kernel config: bridge VLANs, link down, MTU, netem', hw: 'Same faults on real switches' },
  { cap: 'Optical DOM', sim: 'Modeled readings vs fixture thresholds', lab: 'Not available — veth has no optics', hw: 'Real transceivers; meter or OTDR', labNone: true },
  { cap: 'Patch panels & trunk', sim: 'Modeled for tracing and labels', lab: 'Registry only (modeled)', hw: 'Physical panels, inspection, cleaning', labNone: true },
  { cap: 'Throughput', sim: 'Modeled bounded test', lab: 'iperf3 over veth — CPU-bound', hw: 'Line rate on real NICs and optics' },
  { cap: 'Timing', sim: 'Simulated clock (T+…)', lab: 'Wall-clock time of real commands', hw: 'Real alarm and detection timing' },
]

const DOCS: { file: string; what: string }[] = [
  { file: 'README.md', what: 'Quick start, ports, feature map' },
  { file: 'docs/ARCHITECTURE.md', what: 'Components, design decisions, request flow' },
  { file: 'docs/DATA_MODEL.md', what: 'Tables, constraints, evidence records' },
  { file: 'docs/SCENARIOS.md', what: 'The five scenarios, faults and recovery checks' },
  { file: 'docs/RUNBOOKS.md', what: 'Step-by-step troubleshooting procedures' },
  { file: 'docs/LINUX_LAB.md', what: 'Runner setup, safety boundary, teardown' },
  { file: 'docs/LIMITATIONS.md', what: 'Everything the model does not do' },
  { file: 'docs/TEST_RESULTS.md', what: 'What was tested, and where' },
]

// ---------------------------------------------------------------- pieces

const M = ({ children }: { children: ReactNode }) => <code className="rounded bg-canvas px-1 py-px font-mono text-[12.5px] text-ink">{children}</code>

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 border-t border-line pt-7">
      <h2 id={`${id}-h`} tabIndex={-1} className="text-[19px] font-semibold tracking-tight text-ink outline-none">
        {title}
      </h2>
      <div className="mt-3 space-y-4 text-[14.5px] leading-relaxed text-ink/85">{children}</div>
    </section>
  )
}

function LabStatus() {
  const lab = useQuery({ queryKey: qk.lab, queryFn: api.lab, staleTime: 30_000, retry: 0 })
  const s = lab.data
  const label = s ? (s.available ? 'Ready' : s.enabled ? 'Not ready' : 'Disabled') : lab.error ? 'Unknown' : '…'
  const tone = s ? (s.available ? 'ok' : s.enabled ? 'warn' : 'neutral') : 'neutral'
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
      On this installation: <Badge tone={tone}>{label.toUpperCase()}</Badge>
      <Link to="/settings#lab-mode" className="font-medium text-accent-strong hover:underline">
        Lab mode settings
      </Link>
    </span>
  )
}

function SourceModes() {
  const modes: { badge: ReactNode; name: string; note: string; body: ReactNode; extra?: ReactNode }[] = [
    {
      badge: <SourceBadge mode="SIMULATED" />,
      name: 'Simulation',
      note: 'Default',
      body: (
        <>
          A deterministic model of the North Lab Fabric generates every reading. Same inputs, same output. Needs no privileges and runs on macOS, Windows or Linux. Patch panels, trunk and optics are modeled.
        </>
      ),
    },
    {
      badge: <SourceBadge mode="LINUX_LAB" />,
      name: 'Linux lab',
      note: 'Optional · Linux only',
      body: (
        <>
          Real Linux networking in isolated <M>fslab-*</M> namespaces — veth pairs, VLAN-aware bridges, netem — driven by a separate privileged runner on loopback. Must be explicitly enabled. Not physical optics: the low-Rx scenario stays simulation-only.
        </>
      ),
      extra: <LabStatus />,
    },
    {
      badge: <SourceBadge mode="IMPORTED_SAMPLE" />,
      name: 'Imported sample',
      note: 'Untrusted',
      body: (
        <>
          External optical readings in the <M>fiberscope.optical-observation.v1</M> format. Validated for type and range only, stored as untrusted, and labeled as imported wherever they appear.
        </>
      ),
    },
  ]
  return (
    <>
      <p>Every evidence item records the source it came from, and the label travels with it into investigations and reports.</p>
      <dl className="divide-y divide-line-2 border-y border-line-2">
        {modes.map((m) => (
          <div key={m.name} className="grid gap-x-6 gap-y-1.5 py-4 sm:grid-cols-[150px_minmax(0,1fr)]">
            <dt className="min-w-0">
              <div className="text-[14.5px] font-semibold text-ink">{m.name}</div>
              <div className="mt-0.5 text-[12.5px] text-muted">{m.note}</div>
            </dt>
            <dd className="min-w-0 space-y-2">
              <div>{m.badge}</div>
              <p>{m.body}</p>
              {m.extra}
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function CapabilityTable() {
  return (
    <>
      <div className="scroll-thin hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13px] leading-snug">
          <caption className="sr-only">Capability by mode: simulation, Linux lab, physical hardware</caption>
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.07em] text-muted">
              <th scope="col" className="w-[24%] py-2 pr-3 font-semibold">Capability</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Simulation</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Linux lab</th>
              <th scope="col" className="py-2 font-semibold">Needs real hardware</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {CAPS.map((r) => (
              <tr key={r.cap} className="align-top">
                <th scope="row" className="py-2.5 pr-3 font-medium text-ink">
                  {r.cap}
                </th>
                <td className="py-2.5 pr-3 text-ink/85">{r.sim}</td>
                <td className={clsx('py-2.5 pr-3', r.labNone ? 'text-faint' : 'text-ink/85')}>{r.lab}</td>
                <td className="py-2.5 text-muted">{r.hw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line-2 border-y border-line-2 sm:hidden">
        {CAPS.map((r) => (
          <li key={r.cap} className="py-3">
            <div className="text-[14px] font-medium text-ink">{r.cap}</div>
            <dl className="mt-1 space-y-1 text-[13px]">
              {(
                [
                  ['Simulation', r.sim, false],
                  ['Linux lab', r.lab, r.labNone],
                  ['Hardware', r.hw, false],
                ] as const
              ).map(([k, v, none]) => (
                <div key={k} className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                  <dt className="pt-px text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
                  <dd className={none ? 'text-faint' : 'text-ink/85'}>{v}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------- page

export default function About() {
  const loc = useLocation()
  const navigate = useNavigate()
  const first = useRef(true)

  // Scroll to the section named in the URL hash (on load and when it changes).
  useEffect(() => {
    const id = loc.hash.slice(1)
    const initial = first.current
    first.current = false
    if (!id) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => {
      const el = document.getElementById(decodeURIComponent(id))
      el?.scrollIntoView({ block: 'start', behavior: initial || reduce ? 'auto' : 'smooth' })
      el?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
    }, initial ? 120 : 0)
    return () => clearTimeout(t)
  }, [loc.hash])

  const go = (id: string) => {
    if (loc.hash === `#${id}`) document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else navigate({ hash: id }, { replace: true })
  }

  return (
    <Page>
      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:sticky lg:top-8 lg:block lg:self-start" aria-label="On this page">
          <div className="eyebrow mb-2">On this page</div>
          <nav>
            <ul className="space-y-0.5 border-l border-line">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      go(s.id)
                    }}
                    className={clsx('-ml-px block border-l py-1 pl-3 text-[13px] transition-colors', loc.hash === `#${s.id}` ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 max-w-[760px]">
          <header className="pb-7">
            <div className="eyebrow mb-1.5">FiberScope</div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-[28px]">About & Documentation</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink/85">
              FiberScope is an independent network and fiber troubleshooting lab. It is not affiliated with any employer or vendor, is not deployed in production, and makes no claims about production performance.
            </p>
          </header>

          <div className="space-y-9">
            <DocSection id="source-modes" title="Source modes">
              <SourceModes />
            </DocSection>

            <DocSection id="limitations" title="Model limitations">
              <ul className="space-y-2">
                {LIMITATIONS.map((l, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-[10px] size-1 shrink-0 rounded-full bg-faint" aria-hidden />
                    <span className="min-w-0">{l}</span>
                  </li>
                ))}
              </ul>
            </DocSection>

            <DocSection id="real-vs-simulated" title="Real vs simulated">
              <p>Simulation is the default. The Linux lab adds real Linux networking but no physical fiber. Anything optical or physical beyond that requires real hardware.</p>
              <CapabilityTable />
            </DocSection>

            <DocSection id="architecture" title="Architecture">
              <p>
                One investigation workflow runs against two interchangeable backends. The web API never runs as root; real Linux networking is delegated to a separate, optional runner reachable only on loopback with a token.
              </p>
              <ArchitectureDiagram />
              <ul className="space-y-2 text-[14px]">
                <li>
                  <strong className="font-semibold text-ink">State drives symptoms.</strong> Faults mutate a per-execution state document; every reading is derived from it with seeded randomness.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Evidence is immutable.</strong> Append-only rows with a SHA-256 content hash, re-verified on read. Reports are built from stored history only.
                </li>
                <li>
                  <strong className="font-semibold text-ink">Resolution is earned.</strong> Baseline, fault, cited diagnosis, repair, then a passing scenario-specific verification — a ping alone never resolves.
                </li>
              </ul>
            </DocSection>

            <DocSection id="run-locally" title="Run locally">
              <p>
                Requires <M>uv</M> (Python 3.12) and Node.js 22+. Migrations and seeding run on API start.
              </p>
              <div className="grid gap-3">
                <CodeBlock title="API · 127.0.0.1:8077" code={'cd backend\nuv sync\nuv run uvicorn app.main:app --host 127.0.0.1 --port 8077'} />
                <CodeBlock title="Web app · 127.0.0.1:5188" code={'cd frontend\nnpm ci\nnpm run dev'} />
                <div className="grid gap-3 md:grid-cols-2">
                  <CodeBlock title="Docker · localhost:8080" code={'docker compose up --build'} />
                  <CodeBlock title="Tests" code={'cd backend && uv run pytest\ncd frontend && npx playwright test'} />
                </div>
              </div>
              <p className="text-[13.5px] text-muted">
                API reference (OpenAPI):{' '}
                <a href="http://127.0.0.1:8077/docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12.5px] text-accent-strong hover:underline">
                  127.0.0.1:8077/docs <ExternalLink className="size-3" aria-hidden />
                </a>
                . The Linux lab setup is in{' '}
                <Link to="/settings#lab-mode" className="font-medium text-accent-strong hover:underline">
                  Settings → Lab mode
                </Link>
                .
              </p>
            </DocSection>

            <DocSection id="docs" title="Full documentation">
              <p>The repository holds the complete documentation as Markdown.</p>
              <dl className="divide-y divide-line-2 border-y border-line-2 text-[13.5px]">
                {DOCS.map((d) => (
                  <div key={d.file} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[200px_minmax(0,1fr)]">
                    <dt className="font-mono text-[12.5px] text-ink">{d.file}</dt>
                    <dd className="text-muted">{d.what}</dd>
                  </div>
                ))}
              </dl>
              <Link to="/learn" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent-strong hover:underline">
                Troubleshooting guide <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </DocSection>
          </div>
        </article>
      </div>
    </Page>
  )
}
