import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import clsx from 'clsx'
import { AlertTriangle, ArrowRight, Search, X } from 'lucide-react'
import { Page } from '../components/AppShell'
import { PageHeader } from '../components/ui'

// ---------------------------------------------------------------- content helpers

const M = ({ children }: { children: ReactNode }) => <code className="rounded bg-canvas px-1 py-px font-mono text-[12.5px] text-ink">{children}</code>

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-left text-[13px] leading-snug">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-[0.07em] text-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="py-2 pr-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-2">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={clsx('py-2 pr-3', j === 0 ? 'font-medium text-ink' : 'text-ink/85')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[10px] size-1 shrink-0 rounded-full bg-faint" aria-hidden />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  )
}

type Topic = {
  id: string
  title: string
  summary: string
  keywords: string
  body: ReactNode
  example: ReactNode
  scenario?: { key: string; title: string }
  safety?: boolean
}

// ---------------------------------------------------------------- topics

const TOPICS: Topic[] = [
  {
    id: 'admin-vs-oper',
    title: 'Administrative vs operational interface state',
    summary: 'What the port is configured to do vs what the link is actually doing.',
    keywords: 'admin oper shutdown no shutdown carrier NO-CARRIER link down err-disabled',
    scenario: { key: 'admin-down', title: 'Administratively disabled port' },
    body: (
      <>
        <p>
          <strong>Administrative state</strong> is configuration: an operator (or automation) set the port up or down — <M>shutdown</M> / <M>no shutdown</M> on a switch, <M>ip link set dev X down</M> on Linux. <strong>Operational state</strong> is reality: does the port have carrier and a working link with its peer?
        </p>
        <Table
          head={['Admin', 'Oper', 'What it usually means']}
          rows={[
            ['up', 'up', 'Healthy at layer 1. Says nothing yet about VLAN, MTU or loss.'],
            ['up', 'down', 'Something on the physical path or the far end: cord, connector, optic, a far-end port that is shut down, or a protection feature (err-disabled).'],
            ['down', 'down', 'Deliberately disabled. Find out why before enabling it — it may be part of maintenance or isolation.'],
          ]}
        />
        <Points
          items={[
            <>A port that is admin down on one side shows <em>oper down / no carrier</em> on the other side. Always read both ends.</>,
            <>Re-enabling a port is a change. Confirm it was not shut intentionally (change ticket, maintenance window) and change only that port.</>,
          ]}
        />
      </>
    ),
    example: (
      <>
        In <strong>admin-down</strong>, asw-1 <M>Ethernet1/1</M> is shut down after a maintenance window. Server A reports <M>eth0</M> <M>NO-CARRIER</M>: the server side is <em>admin up / oper down</em>, the switch side is <em>admin down</em>. The repair enables only asw-1 Ethernet1/1; verification requires admin and oper up on both ends, then 10/10 probes to Server B and the gateway.
      </>
    ),
  },
  {
    id: 'physical-vs-vlan',
    title: 'Physical connectivity vs VLAN connectivity',
    summary: 'A link light proves layer 1 — not that the port is in the right broadcast domain.',
    keywords: 'vlan access trunk allowed tagged untagged link light layer 2 broadcast domain',
    scenario: { key: 'wrong-vlan', title: 'Wrong VLAN on an access port' },
    body: (
      <>
        <p>
          An <strong>access port</strong> carries one untagged VLAN. A <strong>trunk</strong> carries a list of allowed, tagged VLANs. Two hosts can both have perfect links and still be unable to talk if one of them sits in a different VLAN, or if a trunk between them does not allow that VLAN.
        </p>
        <Points
          items={[
            'Signature of a layer 2 fault: link up, no error counters, but neighbor resolution for the peer fails.',
            'Compare the running VLAN membership with the documented intent, per port — including the trunk allowed lists along the path.',
            'Fix the one port that differs from intent; do not “open up” trunks to make the symptom go away.',
          ]}
        />
      </>
    ),
    example: (
      <>
        In <strong>wrong-vlan</strong>, asw-2 <M>Ethernet1/1</M> (Server B) is moved from access VLAN <M>20</M> (APP-DATA, 192.0.2.0/24) to VLAN <M>30</M> (STORAGE). Server B’s link light is on, yet Server A cannot reach <M>192.0.2.12</M>. The VLAN-membership check flags that single port; the asw-1 ↔ asw-2 uplink <M>Ethernet1/49</M> allows 20 and 30, so the trunk is not the problem. The repair restores only that port to VLAN 20.
      </>
    ),
  },
  {
    id: 'neighbor-resolution',
    title: 'Neighbor resolution (ARP / ND)',
    summary: 'FAILED vs STALE vs REACHABLE — and why a cached entry proves nothing.',
    keywords: 'arp neighbor discovery nd ip neigh failed stale reachable incomplete mac',
    scenario: { key: 'wrong-vlan', title: 'Wrong VLAN on an access port' },
    body: (
      <>
        <p>
          Before sending to an address on the same subnet, a host must learn the peer’s MAC address: <strong>ARP</strong> for IPv4, <strong>Neighbor Discovery</strong> (neighbor solicitation / advertisement) for IPv6. Linux shows the result with <M>ip neigh</M>.
        </p>
        <Table
          head={['State', 'Meaning', 'How to read it']}
          rows={[
            [<M key="r">REACHABLE</M>, 'Recently confirmed by the peer.', 'Layer 2 to that address worked very recently.'],
            [<M key="s">STALE</M>, 'Cached MAC, not confirmed recently.', 'Normal after idle time. Not a failure — and not proof of reachability either. The kernel re-probes on next use.'],
            [<M key="i">INCOMPLETE</M>, 'Resolution in progress.', 'Requests sent, no answer yet.'],
            [<M key="f">FAILED</M>, 'Resolution attempts got no reply.', 'Strong signal that the layer 2 path to that IP is broken (or the host is down).'],
          ]}
        />
        <Points items={['Generate fresh traffic (a probe) before reading the table, so you see a current result rather than a cached one.', 'Read the table on both endpoints — resolution can fail in one direction only.']} />
      </>
    ),
    example: (
      <>
        After the wrong-VLAN fault is injected, Server A’s entry for <M>192.0.2.12</M> drops to <M>STALE</M> (cached, unconfirmed). A fresh reachability probe then leaves it <M>FAILED</M> with no MAC. The scenario’s verification sends a probe first and then requires Server A to resolve Server B’s MAC <M>02:00:5e:10:00:12</M> again.
      </>
    ),
  },
  {
    id: 'loss-vs-errors',
    title: 'Packet loss vs interface errors',
    summary: 'Loss with clean CRC counters points away from the physical layer.',
    keywords: 'packet loss crc fcs errors drops discards netem qdisc congestion counters delta',
    scenario: { key: 'packet-loss', title: 'Packet loss on a lab link' },
    body: (
      <>
        <p>
          <strong>Interface errors</strong> (CRC/FCS, symbol errors, runts) mean frames arrived corrupted — typical of a dirty connector, a damaged cord or a failing optic. <strong>Packet loss</strong> can also happen with no corruption at all: queue drops under congestion, policing, discards, or a deliberate impairment such as Linux <M>tc netem</M>. Those do not increment CRC counters.
        </p>
        <Points
          items={[
            'Loss + rising CRC/FCS → look at the physical layer on that hop.',
            'Loss + clean error counters → look at drops/discards, queueing, policies or an impairment on the path.',
            'Counters are cumulative: compare deltas over a known interval, not absolute totals.',
            'Use enough samples. 1 lost out of 10 is “10 %” but statistically weak; compare against a baseline run with identical parameters.',
          ]}
        />
      </>
    ),
    example: (
      <>
        In <strong>packet-loss</strong>, a FiberScope-owned netem rule <M>fs-imp-0001</M> drops about 15 % of packets on an uplink egress. Interface counters stay free of CRC errors — the loss is visible in probes and in the impairment listing, not in error counters. The repair removes only that owned rule (ownership verified); verification runs 100 probes with the same parameters as the baseline and requires loss no worse than baseline.
      </>
    ),
  },
  {
    id: 'mtu',
    title: 'MTU and fragmentation',
    summary: 'Small pings pass, bulk transfers hang. DF probes find the hop.',
    keywords: 'mtu jumbo 9000 9216 1500 df dont fragment fragmentation pmtud 28 48 overhead oversize giant',
    scenario: { key: 'mtu-mismatch', title: 'MTU mismatch' },
    body: (
      <>
        <p>
          The <strong>MTU</strong> is the largest IP packet an interface will send. A ping’s payload is smaller than the packet: ICMP echo over IPv4 adds <strong>28 B</strong> (20 B IP + 8 B ICMP); over IPv6 it adds <strong>48 B</strong> (40 B IPv6 + 8 B ICMPv6). So a 1472-byte payload is a 1500-byte packet, and an 8972-byte payload is a 9000-byte packet.
        </p>
        <Points
          items={[
            <>Set the <strong>DF (don’t fragment)</strong> bit — <M>ping -M do -s 8972</M> on Linux — so an oversize probe fails instead of being fragmented and silently “passing”.</>,
            'Layer 2 switches do not fragment and do not send ICMP errors: an oversize frame is simply dropped (watch oversize/giant counters).',
            'Routers can signal “fragmentation needed” / “packet too big” for path-MTU discovery — unless that ICMP is filtered, which creates a black hole.',
            'Classic symptom: default ping works, the TCP handshake works, large transfers stall.',
          ]}
        />
      </>
    ),
    example: (
      <>
        In <strong>mtu-mismatch</strong>, hosts run MTU 9000 and switch ports 9216; one segment on the path is set to 1500. The probe ladder of <M>56</M>, <M>1472</M> and <M>8972</M>-byte DF payloads shows the boundary: the first two pass, the <M>8972-byte DF probe</M> fails. The repair restores the intended MTU on that one interface; verification requires all three sizes to pass in both directions and every data-path interface to match its documented MTU.
      </>
    ),
  },
  {
    id: 'tx-vs-rx',
    title: 'Optical transmit vs receive power',
    summary: 'Direction matters. Loss estimate = Tx (remote) − Rx (local).',
    keywords: 'optical dom ddm tx rx power dbm loss budget direction duplex fiber estimate',
    scenario: { key: 'low-rx-power', title: 'Low optical receive power' },
    safety: true,
    body: (
      <>
        <p>
          A duplex link uses one fiber per direction. The power a module <strong>receives</strong> was transmitted by the module at the <em>other</em> end. Low Rx on one port therefore concerns the fiber running <em>toward</em> that port — not the reverse fiber.
        </p>
        <div className="rounded-md border border-line bg-stage px-4 py-2.5 font-mono text-[13px] text-ink">
          estimated loss (dB) = Tx<sub>remote</sub> (dBm) − Rx<sub>local</sub> (dBm)
        </div>
        <Points
          items={[
            'Check the remote transmitter first: weak Tx and a lossy path both produce low Rx.',
            'Check the reverse direction: if both directions are low, suspect something shared (both strands of a cord, a cassette, the trunk) or a wrong fiber/optic type.',
            'Compare the estimate with a planning budget (fiber length × attenuation + mated pairs × assumed loss).',
            'DOM readings have limited accuracy, so this is an estimate — not a light-meter or OTDR measurement — and it does not locate the fault.',
          ]}
        />
      </>
    ),
    example: (
      <>
        In <strong>low-rx-power</strong>, asw-1 <M>Ethernet1/1</M> reports <M>Rx −11.5 dBm</M> against its module’s low-warning of <M>−9.9 dBm</M>, while the link stays up. Server A’s Tx is normal (about −1.8 dBm) and Server A’s own Rx is normal, so the problem is directional: the Server A → asw-1 fiber. The estimate (≈ 9.7 dB) is far above the documented budget for that path (≈ 1.3 dB for 35 m of OM4 and four mated pairs) — evidence of a degraded path, not proof of which part failed. The next step is a cable trace and connector inspection point by point.
      </>
    ),
  },
  {
    id: 'thresholds',
    title: 'Why thresholds depend on the optic',
    summary: 'Alarm and warning limits come from each module’s EEPROM. Unknown is not healthy.',
    keywords: 'thresholds eeprom sff-8472 cmis alarm warning sr lr module third-party unknown',
    scenario: { key: 'low-rx-power', title: 'Low optical receive power' },
    body: (
      <>
        <p>
          Transceivers with digital diagnostics store their own high/low <strong>alarm</strong> and <strong>warning</strong> thresholds for Rx and Tx power, temperature, supply voltage and laser bias in EEPROM (SFF-8472 for SFP/SFP28; CMIS for newer form factors). A short-reach 850 nm multimode module and a 1310 nm single-mode module have different receiver ranges, so the same reading can be normal on one and a warning on the other.
        </p>
        <Points
          items={[
            'Always compare a reading against that specific module’s thresholds, never a remembered “typical” number.',
            'Some modules report readings but no thresholds (or no DOM at all). The status is then unknown — which must never be treated as a pass.',
            'Trend and compare with the far end: a single odd value can be a sensor problem.',
          ]}
        />
      </>
    ),
    example: (
      <>
        The fixture’s 25GBASE-SR optics use an Rx low-warning of <M>−9.9 dBm</M> and low-alarm of <M>−13.9 dBm</M>; the 25GBASE-LR uplink optics on <M>Ethernet1/49</M> use <M>−13.4</M> / <M>−15.4 dBm</M>. Server B’s third-party optic reports DOM values but <em>no thresholds</em> — FiberScope shows “thresholds unknown” and verification does not count it as a pass. These are illustrative fixture values, not vendor data.
      </>
    ),
  },
  {
    id: 'ping-not-enough',
    title: 'Why a successful ping is insufficient verification',
    summary: 'Verify against the original symptom, in both directions, against a baseline.',
    keywords: 'verification ping recovery checks baseline throughput both directions evidence',
    body: (
      <>
        <p>
          A default ping is a few small ICMP packets in one direction. It can pass while large packets are dropped, while 15 % of traffic is lost, while an optic sits below its warning threshold, or while the reverse direction is broken.
        </p>
        <Points
          items={[
            'Re-run the test that failed, with the same parameters (sizes, counts, direction).',
            'Confirm configuration matches documented intent — not just that traffic flows.',
            'Test both directions and compare with a baseline captured before the fault.',
            'Record the verification as evidence. If it fails, the investigation is not resolved.',
          ]}
        />
      </>
    ),
    example: (
      <>
        Each FiberScope scenario defines its own recovery checks. <strong>mtu-mismatch</strong> requires 56, 1472 and 8972-byte DF probes both ways plus MTU-vs-intent on every hop. <strong>packet-loss</strong> requires the impairment rule to be gone <em>and</em> loss no worse than an identical baseline run. <strong>low-rx-power</strong> requires Rx inside each module’s thresholds at both ends (unknown never counts), the loss estimate within budget + 1.5 dB, link up, 10/10 probes and throughput ≥ 90 % of baseline. A failed verification is recorded and counted.
      </>
    ),
  },
  {
    id: 'escalate',
    title: 'When to escalate rather than replace hardware',
    summary: 'No evidence of a failed part means no part swap. Shared components and safety go up the chain.',
    keywords: 'escalate escalation replace hardware trunk mpo shared repeated failure safety handoff runbook',
    safety: true,
    body: (
      <>
        <p>Replacing a part is a repair only when evidence points to that part. Otherwise it adds risk, uses spares, and can hide the real cause. Escalate — following the local runbook — when:</p>
        <Points
          items={[
            <><strong>The fault is in a shared component</strong> — a trunk, MPO cassette or structured cabling that carries several circuits.</>,
            <><strong>A repair repeatedly fails verification</strong> — the diagnosis is probably wrong; stop and hand off with evidence.</>,
            <><strong>No evidence identifies a failed part</strong> — readings are ambiguous, intermittent, or contradict each other.</>,
            <><strong>The change is outside your scope</strong> — configuration you are not authorised to make, or work that needs a change window.</>,
            <><strong>There is a safety concern</strong> — damaged fiber, an exposed laser source, or any need to view a connector: use an inspection scope, never your eye.</>,
          ]}
        />
        <p>
          A good handoff states the symptom, scope, what was tested and ruled out (with timestamps and source), what was changed, and the current state.
        </p>
      </>
    ),
    example: (
      <>
        <M>TRK-0102</M> is a modeled 12-fiber MPO trunk between racks R01 and R02 carrying pairs P1–P3 (Server A and Server B circuits plus a spare). A fault there affects more than one circuit, so it is an escalation, not a re-patch. FiberScope’s report export (JSON, CSV or print) is the handoff packet, and each evidence item carries a SHA-256 content hash so the record can be checked as unchanged.
      </>
    ),
  },
]

// ---------------------------------------------------------------- page pieces

function SafetyCallout({ compact }: { compact?: boolean }) {
  return (
    <div role="note" className={clsx('flex gap-2.5 rounded-md border border-warn/20 bg-warn-soft text-[13.5px] leading-relaxed text-ink', compact ? 'px-3 py-2' : 'px-3.5 py-2.5')}>
      <AlertTriangle className="mt-[3px] size-4 shrink-0 text-warn" aria-hidden />
      <p className="min-w-0">
        <strong className="font-semibold text-warn">Fiber safety.</strong> Never look into a fiber connector, cord end or open port — transmitters may be invisible infrared and still active. Use an inspection scope, keep dust caps on, and clean only connectors that fail inspection.
        {!compact && ' FiberScope’s optical faults are modeled; do not bend or damage fiber to reproduce them.'}
      </p>
    </div>
  )
}

function TopicSection({ t, n }: { t: Topic; n: number }) {
  return (
    <article id={t.id} aria-labelledby={`${t.id}-h`} className="scroll-mt-6 border-t border-line pt-7">
      <header>
        <div className="font-mono text-[11.5px] font-medium text-faint">{String(n).padStart(2, '0')}</div>
        <h2 id={`${t.id}-h`} tabIndex={-1} className="mt-1 text-[19px] font-semibold leading-snug tracking-tight text-ink outline-none">
          {t.title}
        </h2>
        <p className="mt-1 text-[14px] text-muted">{t.summary}</p>
      </header>
      <div className="mt-4 space-y-3.5 text-[14.5px] leading-relaxed text-ink/85">{t.body}</div>
      {t.safety && (
        <div className="mt-4">
          <SafetyCallout compact />
        </div>
      )}
      <div className="mt-5 border-l-2 border-line pl-4">
        <div className="eyebrow mb-1">In FiberScope</div>
        <p className="text-[14px] leading-relaxed text-ink/85">{t.example}</p>
        <Link to={t.scenario ? `/scenarios#${t.scenario.key}` : '/scenarios'} className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent-strong hover:underline">
          {t.scenario ? <>Scenario: {t.scenario.title}</> : 'All scenarios'}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  )
}

function topicText(t: Topic) {
  return `${t.title} ${t.summary} ${t.keywords}`.toLowerCase()
}

export default function Learn() {
  const loc = useLocation()
  const [q, setQ] = useState('')
  const [active, setActive] = useState<string>(TOPICS[0].id)
  const query = q.trim().toLowerCase()
  const visible = useMemo(() => {
    const terms = query.split(/\s+/).filter(Boolean)
    return TOPICS.filter((t) => terms.every((w) => topicText(t).includes(w)))
  }, [query])

  // Highlight the topic currently in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const els = visible.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => !!e)
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id)
      },
      { rootMargin: '0px 0px -65% 0px', threshold: 0 },
    )
    els.forEach((e) => obs.observe(e))
    return () => obs.disconnect()
  }, [visible])

  // Deep links: /learn#mtu
  useEffect(() => {
    const id = loc.hash.slice(1)
    if (!id) return
    const t = setTimeout(() => {
      document.getElementById(decodeURIComponent(id))?.scrollIntoView({ block: 'start' })
      setActive(id)
    }, 120)
    return () => clearTimeout(t)
  }, [loc.hash])

  const jump = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
  }

  return (
    <Page>
      <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-w-0 max-w-[760px] lg:col-start-2">
          <PageHeader
            title="Troubleshooting guide"
            description="Nine concepts for diagnosing server-to-switch connectivity, each with an example from this lab. General guidance — always follow your site’s runbooks."
          />
          <SafetyCallout />
        </div>

        {/* Index */}
        <aside className="lg:sticky lg:top-8 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-start" aria-label="Topic index">
          <label htmlFor="learn-search" className="sr-only">
            Filter topics
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input id="learn-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter topics" className="field h-9 bg-panel pl-8 pr-8 text-[13px]" autoComplete="off" />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink" aria-label="Clear filter">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <nav aria-label="Topics" className="mt-3">
            <ol className="space-y-px border-l border-line">
              {visible.map((t) => {
                const n = TOPICS.indexOf(t) + 1
                const on = active === t.id
                return (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        jump(t.id)
                      }}
                      aria-current={on ? 'location' : undefined}
                      className={clsx('-ml-px flex gap-2 border-l py-1.5 pl-3 pr-1 text-[13px] leading-snug transition-colors', on ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
                    >
                      <span className="w-5 shrink-0 font-mono text-[11px] leading-[1.6] text-faint">{String(n).padStart(2, '0')}</span>
                      <span className="min-w-0">{t.title}</span>
                    </a>
                  </li>
                )
              })}
            </ol>
            {visible.length === 0 && <p className="py-2 text-[13px] text-muted">No topics match “{q}”.</p>}
          </nav>
          <p className="mt-4 hidden text-[12px] leading-relaxed text-faint lg:block">Examples use the fictional North Lab Fabric. Optical figures are simulation estimates.</p>
        </aside>

        {/* Topics */}
        <div className="min-w-0 max-w-[760px] lg:col-start-2">
          <div className="space-y-10">
            {visible.map((t) => (
              <TopicSection key={t.id} t={t} n={TOPICS.indexOf(t) + 1} />
            ))}
            {visible.length === 0 && (
              <p className="border-t border-line pt-6 text-[14px] text-muted">
                No topics match your filter.{' '}
                <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => setQ('')}>
                  Clear filter
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </Page>
  )
}
