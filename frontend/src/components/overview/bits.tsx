import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { CopyButton } from '../ui'

/** Router link styled like the UI-kit Button (the kit Button renders a <button>, not a link). */
export function LinkButton({ to, children, variant = 'secondary', size = 'md', icon, className, external }: { to: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' | 'subtle'; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; className?: string; external?: boolean }) {
  const cls = clsx(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 active:scale-[0.98]',
    size === 'sm' && 'h-8 px-2.5 text-[13px]',
    size === 'md' && 'h-9 px-3.5 text-sm',
    size === 'lg' && 'h-11 px-5 text-[15px]',
    variant === 'primary' && 'bg-accent text-white hover:bg-accent-strong',
    variant === 'secondary' && 'border border-line bg-white text-ink hover:border-[#cfc9d6] hover:bg-[#fbfafc]',
    variant === 'ghost' && 'text-muted hover:bg-black/[0.04] hover:text-ink',
    variant === 'subtle' && 'bg-accent-soft text-accent-strong hover:bg-[#e6dcf7]',
    className,
  )
  if (external)
    return (
      <a href={to} className={cls} target="_blank" rel="noreferrer">
        {icon}
        {children}
      </a>
    )
  return (
    <Link to={to} className={cls}>
      {icon}
      {children}
    </Link>
  )
}

/** Graphite command block with a copy button. */
export function CodeBlock({ title, code, className }: { title?: string; code: string; className?: string }) {
  return (
    <div className={clsx('min-w-0 overflow-hidden rounded-md border border-[#2c2a31] bg-[#1d1c21]', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-1">
        <span className="truncate font-mono text-[10.5px] uppercase tracking-wider text-[#a29eab]">{title ?? 'shell'}</span>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre className="scroll-thin overflow-x-auto px-3 py-2.5 text-[12px] leading-[1.6] text-[#e4e1e8]">
        {code.split('\n').map((line, i) => (
          <div key={i}>
            {line.startsWith('#') ? (
              <span className="text-[#8a8692]">{line}</span>
            ) : (
              <>
                <span className="select-none text-[#6c6874]">$ </span>
                {line}
              </>
            )}
          </div>
        ))}
      </pre>
    </div>
  )
}

/** Page section with an accessible heading and a one-time reveal on scroll. */
export function Section({ id, eyebrow, title, description, children, className, actions }: { id: string; eyebrow?: string; title: string; description?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <motion.section
      id={id}
      aria-labelledby={`${id}-h`}
      className={clsx('scroll-mt-6', className)}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1 text-accent-strong">{eyebrow}</div>}
          <h2 id={`${id}-h`} className="text-xl font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 max-w-3xl text-[14.5px] leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </motion.section>
  )
}

/** Stagger children into view once. */
export const revealItem = (i: number) => ({
  initial: { opacity: 0, y: 10 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.4, delay: Math.min(i, 8) * 0.05, ease: [0.22, 1, 0.36, 1] as const },
})
