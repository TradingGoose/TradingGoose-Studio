'use client'

import type React from 'react'
import { useSession } from '@/lib/auth-client'
import { SocketProvider } from '@/contexts/socket-context'

export default function WorkspaceLayoutClient({ children }: { children: React.ReactNode }) {
  const session = useSession()

  const user = session.data?.user
    ? {
        id: session.data.user.id,
        name: session.data.user.name ?? undefined,
        email: session.data.user.email,
      }
    : undefined

  return <SocketProvider user={user}>{children}</SocketProvider>
}
