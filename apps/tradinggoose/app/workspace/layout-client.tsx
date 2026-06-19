'use client'

import type React from 'react'
import { SocketProvider } from '@/contexts/socket-context'

interface WorkspaceLayoutClientProps {
  children: React.ReactNode
  user: {
    id: string
    name?: string | null
    email?: string
  } | null
}

export default function WorkspaceLayoutClient({ children, user }: WorkspaceLayoutClientProps) {
  const socketUser = user
    ? {
        id: user.id,
        name: user.name ?? undefined,
        email: user.email,
      }
    : undefined

  return <SocketProvider user={socketUser}>{children}</SocketProvider>
}
