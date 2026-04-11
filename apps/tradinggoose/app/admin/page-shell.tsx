'use client'

import type { ReactNode } from 'react'
import { GlobalNavbarHeader } from '@/global-navbar'

export function AdminPageShell({
  left,
  center,
  right,
  children,
}: {
  left: ReactNode
  center?: ReactNode
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <GlobalNavbarHeader left={left} center={center} right={right} />
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden p-1'>
          <div className='min-h-0 flex-1 overflow-auto p-4'>{children}</div>
        </div>
      </div>
    </>
  )
}
