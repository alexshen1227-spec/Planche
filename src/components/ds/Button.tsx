import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-strong disabled:opacity-50',
  secondary: 'border border-line-strong bg-raised text-ink hover:bg-surface disabled:opacity-50',
  ghost: 'bg-transparent text-ink2 hover:bg-raised hover:text-ink disabled:opacity-50',
  danger: 'bg-danger-solid text-white hover:opacity-90 disabled:opacity-50',
}

/**
 * The one button. 44px tall at md, 52px at lg; scales to .97 while pressed
 * (off under reduced motion). `type` defaults to "button" so a button inside
 * a form never submits by accident.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  full = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'md' | 'lg'
  full?: boolean
  children?: ReactNode
}) {
  return (
    <button
      type={type}
      {...rest}
      className={`ds-press inline-flex items-center justify-center gap-2 rounded-control px-4 text-body font-semibold ${
        size === 'lg' ? 'min-h-[52px]' : 'min-h-11'
      } ${full ? 'w-full' : ''} ${VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  )
}
