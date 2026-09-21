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
  message === 'Token validation failed' ||
  message === 'Failed to generate socket token: 401'
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

interface User {
  id: string
  name?: string
  email?: string
}

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  isConnecting: boolean
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isConnecting: false,
})

export const useSocket = () => useContext(SocketContext)

interface SocketProviderProps {
  children: ReactNode
  user?: User
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

export function SocketProvider({ children, user }: SocketProviderProps) {
  const pathname = usePathname()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
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
    if (!user?.id) {
      setSocket(null)
      setIsConnected(false)
      setIsConnecting(false)
      return
    }

    const registry = (globalThis.__socketRegistry ??= new Map())
    let entry = registry.get(user.id)
    if (entry) {
      logger.info('Reusing existing shared socket connection', { userId: user.id })
    } else {
      logger.info('Initializing new socket connection for user:', user.id)

      const socketUrl = getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002'

      logger.info('Attempting to connect to Socket.IO server', {
        url: socketUrl,
        userId: user?.id || 'no-user',
        timestamp: new Date().toISOString(),
      })

      const socketInstance = io(socketUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnectionAttempts: Number.POSITIVE_INFINITY,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        timeout: 10000,
        auth: async (cb) => {
          try {
            const freshToken = await generateSocketToken()
            cb({ token: freshToken })
          } catch (error) {
            logSocketIssue(
              'Failed to generate fresh token for connection:',
              {
                message: error instanceof Error ? error.message : String(error),
              },
              callbackPathnameRef.current
            )
            cb({ token: null })
          }
        },
      })

      entry = { socket: socketInstance, owners: 0 }
      registry.set(user.id, entry)
    }

    entry.owners += 1
    const socketInstance = entry.socket
    setSocket(socketInstance)
    setIsConnected(socketInstance.connected)
    setIsConnecting(!socketInstance.connected && socketInstance.active)

    const onConnect = () => {
      setIsConnected(true)
      setIsConnecting(false)
      logger.info('Socket connected successfully', {
        socketId: socketInstance.id,
        connected: socketInstance.connected,
      })
    }

    const onDisconnect = (reason: string) => {
      setIsConnected(false)
      setIsConnecting(false)
      logger.info('Socket disconnected', { reason })
    }

    const onConnectError = (error: any) => {
      setIsConnected(false)
      setIsConnecting(false)
      logSocketIssue(
        'Socket connection error:',
        {
          message: error instanceof Error ? error.message : String(error),
          type: error?.type,
        },
        callbackPathnameRef.current
      )
    }

    socketInstance.on('connect', onConnect)
    socketInstance.on('disconnect', onDisconnect)
    socketInstance.on('connect_error', onConnectError)

    return () => {
      socketInstance.off('connect', onConnect)
      socketInstance.off('disconnect', onDisconnect)
      socketInstance.off('connect_error', onConnectError)
      entry.owners -= 1
      if (entry.owners === 0) {
        logger.info('Cleaning up socket connection after final provider release')
        if (registry.get(user.id) === entry) registry.delete(user.id)
        socketInstance.disconnect()
      }
    }
  }, [user?.id])

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        isConnecting,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}
