import type { MouseEvent, ReactNode } from 'react'
import { navigate } from '@/lib/route'

/** A real link (so it works with a new tab and without script) that navigates in place on a plain click. */
export function NavLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  )
}
