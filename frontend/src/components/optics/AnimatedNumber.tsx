import { useLayoutEffect, useRef } from 'react'
import { animate, useReducedMotion } from 'motion/react'
import { fmtVal } from './model'

/** Counts from the previously shown value to the new one. Renders "Not reported" for null — never 0. */
export function AnimatedNumber({ value, digits = 2, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<number | null>(null)
  const reduced = useReducedMotion()

  // Text is owned by this effect (not React children) so the tween can write to the node directly.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (value == null) {
      el.textContent = fmtVal(null)
      prev.current = null
      return
    }
    const from = prev.current ?? value
    prev.current = value
    if (reduced || from === value) {
      el.textContent = fmtVal(value, digits)
      return
    }
    const ctl = animate(from, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = fmtVal(v, digits)
      },
    })
    return () => ctl.stop()
  }, [value, digits, reduced])

  return (
    <span ref={ref} className={className} />
  )
}
