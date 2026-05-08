'use client'

import type { ReactNode } from 'react'
import { GlobalNavbarHeader } from '@/global-navbar'

interface LogsToolbarProps {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
}

export function LogsToolbar({ left, center, right }: LogsToolbarProps) {
  return <GlobalNavbarHeader left={left} center={center} right={right} />
}
