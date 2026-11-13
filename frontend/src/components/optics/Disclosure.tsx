import { useId, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'

/** Flat, hairline-divided disclosure section. Collapsed by default; the button carries aria-expanded / aria-controls. */
export function Disclosure({ title, meta, children, defaultOpen = false, className }: { title: ReactNode; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className={clsx('border-t border-line', className)}>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          id={`${id}-btn`}
          onClick={() => setOpen((o) => !o)}
          className="group flex w-full items-center gap-2 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ChevronRight className={clsx('size-4 shrink-0 text-faint transition-transform group-hover:text-ink', open && 'rotate-90')} aria-hidden />
          <span className="text-[14px] font-semibold text-ink">{title}</span>
          {meta && <span className="ml-auto min-w-0 pl-3 text-right text-[12px] leading-snug text-muted max-sm:max-w-[48%] sm:truncate">{meta}</span>}
        </button>
      </h2>
      <div id={`${id}-body`} role="region" aria-labelledby={`${id}-btn`} hidden={!open} className="pb-5 pl-6">
        {open && children}
      </div>
    </section>
  )
}
