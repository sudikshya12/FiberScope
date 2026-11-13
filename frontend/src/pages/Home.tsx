import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { ArrowRight, ChevronDown, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { Logo } from '../components/AppShell'

const FILM = '/media/fiberscope-film.mp4'
const POSTER = '/media/fiberscope-poster.jpg'
const ease = [0.22, 1, 0.36, 1] as const

/* Fiber strands crossing the hero, each carrying a slow light pulse (decorative; off for reduced motion). */
const STRANDS = [
  'M-40 520 C 260 470, 420 610, 720 560 S 1180 430, 1480 500',
  'M-40 160 C 220 230, 520 90, 760 150 S 1220 260, 1480 190',
  'M-40 640 C 300 600, 560 700, 860 650 S 1260 590, 1480 640',
  'M-40 330 C 280 300, 460 400, 740 360 S 1140 270, 1480 330',
  'M-40 60 C 340 110, 640 20, 900 70 S 1300 120, 1480 80',
]

const STORY = [
  { tone: '#BE3545', sym: '✕', label: 'Symptom', text: 'Server B unreachable' },
  { tone: '#C08A1E', sym: '▲', label: 'Evidence', text: 'VLAN 30 ≠ intended 20' },
  { tone: '#3E9B6B', sym: '●', label: 'Verified', text: 'Recovery verified · resolved' },
]

function Strands({ reduce }: { reduce: boolean | null }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1440 720" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="fs-pulse-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#9b7be0" stopOpacity="0" />
          <stop offset="0.7" stopColor="#b9a2ec" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="1" />
        </linearGradient>
      </defs>
      {STRANDS.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="rgba(245,243,239,0.06)" strokeWidth="1.2" />
          {!reduce && (
            <path
              d={d}
              fill="none"
              stroke="url(#fs-pulse-grad)"
              strokeWidth="1.8"
              strokeLinecap="round"
              pathLength={1000}
              className="fs-pulse"
              style={{ animationDuration: `${6 + i * 1.3}s`, animationDelay: `${i * 0.9}s` }}
            />
          )}
        </g>
      ))}
    </svg>
  )
}

function StoryTicker({ reduce }: { reduce: boolean | null }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setI((x) => (x + 1) % STORY.length), 2600)
    return () => clearInterval(t)
  }, [reduce])
  const s = STORY[i]
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {STORY.map((_, k) => (
          <span key={k} className="h-1 rounded-full transition-all duration-500" style={{ width: k === i ? 18 : 6, background: k === i ? STORY[k].tone : 'rgba(245,243,239,0.18)' }} />
        ))}
      </div>
      <div className="relative h-9 w-[310px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
            transition={{ duration: 0.5, ease }}
            className="absolute inset-0 flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] pl-1.5 pr-4 text-[13.5px]"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold text-white" style={{ background: s.tone }}>
              {s.sym}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a29eab]">{s.label}</span>
            <span className="truncate text-[#ece8f3]">{s.text}</span>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Words({ text, className, delay, reduce }: { text: string; className?: string; delay: number; reduce: boolean | null }) {
  const words = text.split(' ')
  return (
    <span className={className}>
      {words.map((w, k) => (
        <motion.span
          key={k}
          className="inline-block"
          initial={reduce ? false : { opacity: 0, y: '0.45em', filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.9, ease, delay: delay + k * 0.09 }}
        >
          {w}
          {k < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </span>
  )
}

export default function Home() {
  const reduce = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const filmRef = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [playing, setPlaying] = useState(false)

  // Scroll-linked reveal: the film starts tilted back and settles flat as it reaches the centre of the screen.
  const { scrollYProgress } = useScroll({ container: scroller, target: filmRef, offset: ['start end', 'center center'] })
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 })
  const rotateX = useTransform(p, [0, 1], [28, 0])
  const scale = useTransform(p, [0, 1], [0.86, 1])
  const y = useTransform(p, [0, 1], [0, 0])
  const glow = useTransform(p, [0, 1], [0.25, 1])

  // Muted autoplay once the film is in view (browser policy); the preview opens on the product itself.
  useEffect(() => {
    const v = video.current
    const el = filmRef.current
    if (!v || !el || reduce) return
    v.muted = true
    const seek = () => {
      if (v.muted && v.currentTime < 5) v.currentTime = 5.6
    }
    if (v.readyState >= 1) seek()
    else v.addEventListener('loadedmetadata', seek, { once: true })
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) v.play().catch(() => setPlaying(false))
        else if (v.muted) v.pause()
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduce])

  const toFilm = () => filmRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  const watchWithSound = () => {
    const v = video.current
    if (!v) return
    toFilm()
    v.currentTime = 0
    v.muted = false
    setMuted(false)
    v.play()
  }
  const toggleSound = () => {
    const v = video.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
    if (v.paused) v.play()
  }
  const togglePlay = () => {
    const v = video.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  return (
    <div ref={scroller} className="scroll-thin relative h-full overflow-y-auto overflow-x-hidden bg-[#141318] text-[#f5f3ef]">
      <style>{`
        .fs-pulse { stroke-dasharray: 90 910; stroke-dashoffset: 1000; animation-name: fsPulse; animation-timing-function: cubic-bezier(.45,0,.25,1); animation-iteration-count: infinite; }
        @keyframes fsPulse { to { stroke-dashoffset: 0; } }
        .fs-shimmer { background: linear-gradient(100deg, #b9a2ec 0%, #ece4fc 30%, #9b7be0 55%, #d6c8f6 80%, #b9a2ec 100%); background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: fsShimmer 7s ease-in-out infinite; }
        @keyframes fsShimmer { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        .fs-aurora { animation: fsAurora 16s ease-in-out infinite alternate; }
        @keyframes fsAurora { from { transform: translate3d(-4%, -2%, 0) scale(1); } to { transform: translate3d(4%, 3%, 0) scale(1.08); } }
        .fs-breathe { animation: fsBreathe 3.2s ease-in-out infinite; }
        @keyframes fsBreathe { 0%,100% { box-shadow: 0 12px 34px -12px rgba(105,65,198,.65), 0 0 0 0 rgba(155,123,224,0); } 50% { box-shadow: 0 16px 44px -10px rgba(105,65,198,.85), 0 0 0 6px rgba(155,123,224,.12); } }
        @media (prefers-reduced-motion: reduce) { .fs-shimmer, .fs-aurora, .fs-breathe { animation: none !important; } }
      `}</style>

      {/* ---------------------------------------------------------------- hero */}
      <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
        <div aria-hidden className="fs-aurora pointer-events-none absolute -inset-x-[10%] -top-[20%] h-[120%] bg-[radial-gradient(700px_420px_at_30%_35%,rgba(105,65,198,0.30),transparent_70%),radial-gradient(620px_380px_at_75%_55%,rgba(155,123,224,0.16),transparent_70%)]" />
        <Strands reduce={reduce} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#141318]" />

        <header className="relative z-10 mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-5 md:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="FiberScope home">
            <Logo className="size-7" />
            <span className="text-[15.5px] font-semibold tracking-tight">FiberScope</span>
          </Link>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-7 text-[13.5px] text-[#bdb7c6] md:flex">
            <Link to="/scenarios" className="transition-colors hover:text-white">Scenarios</Link>
            <Link to="/investigations" className="transition-colors hover:text-white">Investigations</Link>
            <Link to="/optics" className="transition-colors hover:text-white">Optics</Link>
            <Link to="/about" className="transition-colors hover:text-white">About</Link>
          </nav>
          <Link to="/workbench" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 px-3.5 text-[13.5px] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/5 md:ml-0">
            Open workbench <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-64px-260px)] max-w-[1000px] flex-col items-center justify-center px-5 pb-6 pt-5 text-center">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease }}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-[12.5px] text-[#cfc9d6]"
          >
            <span className="relative flex size-2">
              {!reduce && <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#9b7be0] opacity-60" />}
              <span className="relative inline-flex size-2 rounded-full bg-[#9b7be0]" />
            </span>
            Network &amp; fiber investigation workbench
          </motion.div>

          <h1 id="hero-title" className="mt-5 font-medium leading-[1.03] tracking-[-0.035em]" style={{ fontSize: 'clamp(42px, min(8.4vw, 9.6vh), 84px)' }}>
            <Words text="Find the fault." delay={0.15} reduce={reduce} />
            <br />
            <Words text="Prove the fix." className="fs-shimmer" delay={0.55} reduce={reduce} />
          </h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease, delay: 1.0 }}
            className="mt-4 max-w-[640px] text-[16.5px] leading-relaxed text-[#bdb7c6] md:text-[18px]"
          >
            Every symptom traced to evidence — and only resolved when recovery is verified.
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease, delay: 1.2 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <Link to="/workbench" className="fs-breathe group inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-medium text-white transition-colors hover:bg-accent-strong">
              Open workbench <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <button onClick={watchWithSound} className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-6 text-[15px] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/[0.07]">
              <Play className="size-4" aria-hidden /> Watch the film
            </button>
          </motion.div>

          <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.6 }} className="mt-7">
            <StoryTicker reduce={reduce} />
          </motion.div>

          <motion.button
            onClick={toFilm}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 2.1 }}
            className="mt-4 flex flex-col items-center gap-1 text-[11.5px] uppercase tracking-[0.28em] text-[#8a8692] transition-colors hover:text-[#cfc9d6]"
            aria-label="Scroll to the film"
          >
            The film
            <motion.span animate={reduce ? undefined : { y: [0, 6, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}>
              <ChevronDown className="size-4" aria-hidden />
            </motion.span>
          </motion.button>
        </div>
      </section>

      {/* ---------------------------------------------------------------- film */}
      <section className="relative mx-auto max-w-[1280px] px-4 pb-20 md:px-8" style={{ perspective: 1400 }} aria-label="Product film">
        <motion.div ref={filmRef} style={reduce ? undefined : { rotateX, scale, y, transformOrigin: '50% 0%' }} className="relative mx-auto max-w-[1180px]">
          <motion.div aria-hidden style={reduce ? undefined : { opacity: glow }} className="pointer-events-none absolute -inset-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_50%,rgba(105,65,198,0.35),transparent_70%)] blur-2xl" />
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_50px_140px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(155,123,224,0.10)]">
            <video
              ref={video}
              className="block aspect-video w-full"
              src={FILM}
              poster={POSTER}
              muted
              loop
              playsInline
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              aria-label="FiberScope product film: a wrong-VLAN investigation from symptom to verified recovery"
            />
            {!playing && (
              <button onClick={watchWithSound} className="absolute inset-0 grid place-items-center bg-black/25 transition-colors hover:bg-black/15" aria-label="Play the film with sound">
                <span className="grid size-14 place-items-center rounded-full bg-white/95 text-[#242329] shadow-xl sm:size-20">
                  <Play className="ml-1 size-7 sm:size-8" aria-hidden />
                </span>
              </button>
            )}
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 sm:bottom-3 sm:right-3 sm:gap-2">
              <button onClick={togglePlay} className="grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 sm:size-9" aria-label={playing ? 'Pause film' : 'Play film'}>
                {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              </button>
              <button onClick={toggleSound} className="flex h-7 items-center gap-1.5 rounded-full bg-black/55 px-2 text-[12.5px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75 sm:h-9 sm:px-3.5" aria-label={muted ? 'Turn sound on' : 'Mute'}>
                {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
                <span className="hidden sm:inline">{muted ? 'Sound off' : 'Sound on'}</span>
              </button>
            </div>
          </div>
        </motion.div>
        <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.24em] text-[#77737f]">Recorded in simulation mode · Evidence clearly labeled</p>

        <motion.ol
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, root: scroller }}
          transition={{ duration: 0.9, ease }}
          className="mx-auto mt-16 grid max-w-[980px] gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-4"
        >
          {[
            ['Observe', 'Trace the documented path.'],
            ['Diagnose', 'Cite evidence, not hunches.'],
            ['Repair', 'Change one thing.'],
            ['Verify', 'Prove recovery, then resolve.'],
          ].map(([t, d], i) => (
            <li key={t} className="bg-[#19181e] px-5 py-5 transition-colors hover:bg-[#1e1d24]">
              <span className="font-mono text-[11px] tracking-[0.2em] text-[#9b7be0]">0{i + 1}</span>
              <span className="mt-1.5 block text-[15px] font-medium text-white">{t}</span>
              <span className="mt-0.5 block text-[13px] text-[#a29eab]">{d}</span>
            </li>
          ))}
        </motion.ol>

        <p className="mt-12 text-center text-[12.5px] text-[#77737f]">
          Independent lab · Not affiliated with any vendor or employer ·{' '}
          <Link to="/about" className="underline decoration-white/20 underline-offset-4 hover:text-[#bdb7c6]">
            About & documentation
          </Link>
        </p>
      </section>
    </div>
  )
}
