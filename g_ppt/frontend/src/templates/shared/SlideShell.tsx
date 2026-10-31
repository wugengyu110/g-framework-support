import type { ReactNode } from 'react'
import './slides.css'

type ShellProps = {
  children: ReactNode
  variant?: 'default' | 'hero' | 'code'
}

export function SlideShell({ children, variant = 'default' }: ShellProps) {
  return (
    <div className={`slide-shell slide-shell--${variant}`}>
      <div className="slide-shell__grain" aria-hidden />
      <div className="slide-shell__glow" aria-hidden />
      {children}
    </div>
  )
}

export function SlideSection({ children }: { children: ReactNode }) {
  return <p className="slide-section">{children}</p>
}
