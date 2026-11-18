'use client'

import type React from 'react'
import { useSession } from '@/lib/auth-client'
import { SocketProvider } from '@/contexts/socket-context'

export default function WorkspaceLayoutClient({ children }: { children: React.ReactNode }) {
  const session = useSession()
  return <SocketProvider userId={session.data?.user?.id}>{children}</SocketProvider>
}
