'use client'

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { usePathname } from '@/i18n/navigation'

const logger = createLogger('SocketContext')
const isSocketAuthError = (message: string) =>
  message === 'Authentication required' ||
  message === 'Invalid session' ||
  message === 'Token validation failed'
const logSocketIssue = (
  event: string,
  details: {
    message: string
    type?: string
  },
  callbackPathname: string
) => {
  if (isSocketAuthError(details.message)) {
    logger.warn(event, { ...details, callbackPathname })
    void handleAuthError('socket-auth', callbackPathname)
  } else {
    logger.error(event, details)
  }
}

const SocketContext = createContext<Socket | null>(null)

export const useSocket = () => useContext(SocketContext)

interface SocketProviderProps {
  children: ReactNode
  userId?: string
}

interface SocketRegistryEntry {
  socket: Socket
  owners: number
}

/**
 * The socket registry is stored on `globalThis` rather than as a module-scoped
 * variable so that it survives Next.js Fast Refresh / HMR reloads in development.
 * Module-scoped variables are re-initialised when a module is hot-replaced, which
 * would orphan existing socket connections. `globalThis` persists across reloads.
 */
declare global {
  // eslint-disable-next-line no-var
  var __socketRegistry: Map<string, SocketRegistryEntry> | undefined
}

export function SocketProvider({ children, userId }: SocketProviderProps) {
  const pathname = usePathname()
  const [socket, setSocket] = useState<Socket | null>(null)
  const callbackPathnameRef = useRef(pathname)
  callbackPathnameRef.current = pathname

  // Helper function to generate a fresh socket token
  const generateSocketToken = async (): Promise<string> => {
    const res = await fetch('/api/auth/socket-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'cache-control': 'no-store' },
    })

    if (res.status === 401) {
      throw new Error('Authentication required')
    }

    if (!res.ok) {
      throw new Error(`Failed to generate socket token: ${res.status}`)
    }

    const body = await res.json().catch(() => ({}))
    const token = body?.token
    if (!token || typeof token !== 'string') throw new Error('Invalid socket token')
    return token
  }

  useEffect(() => {
    if (!userId) {
      setSocket(null)
      return
    }

    const registry = (globalThis.__socketRegistry ??= new Map())
    let entry = registry.get(userId)
    if (!entry) {
      const socketUrl = getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002'

      const socketInstance = io(socketUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnectionAttempts: Number.POSITIVE_INFINITY,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        timeout: 10000,
        auth: async (cb) => {
          const engine = socketInstance.io.engine
          try {
            const freshToken = await generateSocketToken()
            if (!socketInstance.active || socketInstance.io.engine !== engine) return
            cb({ token: freshToken })
          } catch (error) {
            if (!socketInstance.active || socketInstance.io.engine !== engine) return
            const message = error instanceof Error ? error.message : String(error)
            logSocketIssue(
              'Failed to generate fresh token for connection:',
              { message },
              callbackPathnameRef.current
            )
            engine.close()
            if (isSocketAuthError(message)) socketInstance.disconnect()
          }
        },
      })

      entry = { socket: socketInstance, owners: 0 }
      registry.set(userId, entry)
    }

    entry.owners += 1
    const socketInstance = entry.socket
    setSocket(socketInstance)

    const onDisconnect = (reason: string) => {
      if (reason === 'io server disconnect' && !socketInstance.active) socketInstance.connect()
    }

    const onConnectError = (error: any) => {
      logSocketIssue(
        'Socket connection error:',
        {
          message: error instanceof Error ? error.message : String(error),
          type: error?.type,
        },
        callbackPathnameRef.current
      )
    }

    socketInstance.on('disconnect', onDisconnect)
    socketInstance.on('connect_error', onConnectError)

    return () => {
      socketInstance.off('disconnect', onDisconnect)
      socketInstance.off('connect_error', onConnectError)
      entry.owners -= 1
      if (entry.owners === 0) {
        if (registry.get(userId) === entry) registry.delete(userId)
        socketInstance.disconnect()
      }
    }
  }, [userId])

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
}
