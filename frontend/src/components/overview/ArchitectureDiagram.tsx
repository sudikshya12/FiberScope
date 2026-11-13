import type { ReactNode } from 'react'
import clsx from 'clsx'

/** Restrained component diagram: hairline boxes, one dashed boundary for the optional privileged runner. */

function Box({ title, sub, children, dashed, strong }: { title: string; sub?: string; children?: ReactNode; dashed?: boolean; strong?: boolean }) {
  return (
    <div className={clsx('min-w-0 rounded-md border bg-panel px-3 py-2.5', dashed ? 'border-dashed border-[#c9c4d1]' : strong ? 'border-ink/30' : 'border-line')}>
      <div className="text-[13px] font-semibold leading-snug text-ink">{title}</div>
      {sub && <div className="mt-0.5 font-mono text-[11px] leading-snug text-muted">{sub}</div>}
      {children && <div className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{children}</div>}
    </div>
  )
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-5" aria-hidden>
      <span className="flex flex-col items-center text-faint">
        <span className="h-3 w-px bg-current" />
        <svg viewBox="0 0 8 5" className="size-2 fill-current">
          <path d="M0 0h8L4 5z" />
        </svg>
      </span>
      {label && <span className="font-mono text-[10.5px] text-faint">{label}</span>}
    </div>
  )
}

export function ArchitectureDiagram() {
  return (
    <figure className="rounded-md border border-line bg-stage p-3 sm:p-4" aria-label="FiberScope architecture diagram">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div className="min-w-0">
          <Box title="Browser — React SPA" sub="React 19 · TypeScript · TanStack Query" />
          <Arrow label="HTTP JSON + server-sent events" />
          <Box strong title="FastAPI web API — unprivileged" sub="pydantic-validated, fixed-schema requests">
            Investigation workflow, cable registry, reports. Never executes free-form commands.
          </Box>
          <Arrow />
          <div className="grid gap-2 sm:grid-cols-3">
            <Box title="Scenario engine" sub="5 versioned scenarios" />
            <Box title="Executors" sub="simulation · linux lab" />
            <Box title="SQLite evidence store" sub="append-only · SHA-256" />
          </div>
        </div>

        <div className="min-w-0 rounded-md border border-dashed border-[#c9c4d1] p-2.5">
          <div className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">Optional · Linux only</div>
          <Box title="Lab runner — privileged" sub="labrunner/fiberscope_labrunner.py">
            127.0.0.1 only, bearer token, allowlisted operations, audit log.
          </Box>
          <Arrow />
          <Box dashed title="fslab-* network namespaces" sub="veth · VLAN-aware bridges · netem">
            Real Linux networking, no physical fiber. Never touches host interfaces, routes, DNS or firewall.
          </Box>
        </div>
      </div>
      <figcaption className="mt-3 border-t border-line-2 pt-2.5 text-[12px] text-muted">The web API reaches the lab runner only when the Linux lab is explicitly enabled. Dashed = optional.</figcaption>
    </figure>
  )
}
