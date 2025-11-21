'use client'

import { useMemo } from 'react'
import { usePathname } from 'next/navigation'

interface WorkspaceShellProps {
  children: React.ReactNode
}

const HIDDEN_SEGMENTS = ['/wtest/', '/chattest/', '/consoletest/', '/wlisttest']

export function WorkspaceShell({ children }: WorkspaceShellProps) {
  const pathname = usePathname()

  const shouldHideSidebar = useMemo(() => {
    if (!pathname) return false
    return HIDDEN_SEGMENTS.some((segment) => pathname.includes(segment))
  }, [pathname])

  return (
    <div className='flex min-h-screen w-full'>
      {!shouldHideSidebar && <div className='z-20'></div>}
      <div className='flex flex-1 flex-col'>{children}</div>
    </div>
  )
}
