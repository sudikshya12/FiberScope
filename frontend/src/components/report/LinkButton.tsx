import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import clsx from 'clsx'

/**
 * Link styled like the UI-kit Button. The kit's Button renders a <button>; wrapping it in a
 * <Link> nests interactive elements, so navigation actions use these instead.
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'subtle'
type Size = 'sm' | 'md'

export function linkButtonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string) {
  return clsx(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 active:scale-[0.98]',
    size === 'sm' && 'h-8 px-2.5 text-[13px]',
    size === 'md' && 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'bg-accent text-white hover:bg-accent-strong',
    variant === 'secondary' && 'border border-line bg-white text-ink hover:border-[#cfc9d6] hover:bg-[#fbfafc]',
    variant === 'ghost' && 'text-muted hover:bg-black/[0.04] hover:text-ink',
    variant === 'subtle' && 'bg-accent-soft text-accent-strong hover:bg-[#e6dcf7]',
    className,
  )
}

export function LinkButton({ variant, size, icon, className, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={linkButtonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}

export function AnchorButton({ variant, size, icon, className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <a className={linkButtonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </a>
  )
}
