import clsx from 'clsx'
import { motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import type { InvStatus } from '../../lib/types'

const STEPS = [
  { key: 'opened', label: 'Opened', hint: 'Investigation created' },
  { key: 'baseline', label: 'Baseline', hint: 'Healthy state recorded for comparison' },
  { key: 'investigating', label: 'Investigate', hint: 'Collect evidence with checks' },
  { key: 'diagnosis', label: 'Diagnose', hint: 'Record a diagnosis citing evidence' },
  { key: 'repair', label: 'Repair', hint: 'Apply the smallest correct change' },
  { key: 'verify', label: 'Verify', hint: 'Scenario-specific recovery checks' },
  { key: 'resolved', label: 'Resolved', hint: 'All resolution criteria met' },
]

const INDEX: Record<InvStatus, number> = {
  opened: 0,
  baseline_reviewed: 1,
  investigating: 2,
  diagnosis_recorded: 3,
  repair_applied: 4,
  verifying: 5,
  verification_failed: 5,
  resolved: 6,
  abandoned: -1,
}

export function Stepper({ status, compact, vertical }: { status: InvStatus; compact?: boolean; vertical?: boolean }) {
  const idx = INDEX[status]
  const failed = status === 'verification_failed'
  const abandoned = status === 'abandoned'
  if (vertical)
    return (
      <ol className="relative space-y-0" aria-label="Investigation workflow">
        {STEPS.map((s, i) => {
          const done = !abandoned && i < idx
          const current = !abandoned && i === idx
          const isFail = current && failed
          return (
            <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0" aria-current={current ? 'step' : undefined}>
              {i < STEPS.length - 1 && <span aria-hidden className={clsx('absolute left-[8px] top-5 h-[calc(100%-14px)] w-px', done ? 'bg-accent' : 'bg-line')} />}
              <span className={clsx('relative z-10 grid size-[17px] shrink-0 place-items-center rounded-full border text-[9px] font-bold', done && 'border-accent bg-accent text-white', current && !isFail && 'border-accent bg-white text-accent', isFail && 'border-crit bg-crit text-white', !done && !current && 'border-line bg-white text-faint')}>
                {done ? <Check className="size-2.5" strokeWidth={3.5} aria-hidden /> : isFail ? <X className="size-2.5" strokeWidth={3.5} aria-hidden /> : i + 1}
              </span>
              <span className="-mt-0.5">
                <span className={clsx('block text-[13px]', current ? 'font-semibold text-ink' : done ? 'text-ink' : 'text-muted')}>{isFail ? 'Verify — failed' : s.label}</span>
                <span className="block text-[11.5px] text-muted">{s.hint}</span>
                <span className="sr-only">{done ? 'complete' : current ? (isFail ? 'failed' : 'current') : 'pending'}</span>
              </span>
            </li>
          )
        })}
        {abandoned && <li className="mt-2 text-[12px] text-muted">Abandoned — closed without success.</li>}
      </ol>
    )
  return (
    <ol className="flex items-center" aria-label="Investigation lifecycle">
      {STEPS.map((s, i) => {
        const done = !abandoned && i < idx
        const current = !abandoned && i === idx
        const isFail = current && failed
        return (
          <li key={s.key} className="flex items-center" aria-current={current ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <motion.span
                initial={false}
                animate={{ scale: current ? 1.08 : 1 }}
                className={clsx(
                  'grid size-[18px] place-items-center rounded-full border text-[9px] font-bold transition-colors duration-300',
                  done && 'border-accent bg-accent text-white',
                  current && !isFail && 'border-accent bg-white text-accent ring-4 ring-accent/15',
                  isFail && 'border-crit bg-crit text-white ring-4 ring-crit/15',
                  !done && !current && 'border-line bg-white text-faint',
                  abandoned && 'opacity-50',
                )}
              >
                {done ? <Check className="size-2.5" strokeWidth={3.5} aria-hidden /> : isFail ? <X className="size-2.5" strokeWidth={3.5} aria-hidden /> : i + 1}
              </motion.span>
              {!compact && <span className={clsx('mt-1 hidden text-[10px] font-medium xl:block', current ? 'text-ink' : 'text-faint')}>{s.label}</span>}
              <span className="sr-only">
                {s.label}: {done ? 'complete' : current ? (isFail ? 'failed' : 'current') : 'pending'}
              </span>
            </div>
            {compact && current && <span className={clsx('ml-1.5 text-[11.5px] font-semibold', isFail ? 'text-crit' : 'text-ink')}>{isFail ? 'Verification failed' : s.label}</span>}
            {i < STEPS.length - 1 && (
              <div className={clsx('relative mx-1 h-[2px] w-4 overflow-hidden rounded bg-line sm:w-6 2xl:w-9', !compact && 'xl:mb-[15px]')}>
                <motion.div className="absolute inset-y-0 left-0 bg-accent" initial={false} animate={{ width: done ? '100%' : '0%' }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 * i }} />
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
