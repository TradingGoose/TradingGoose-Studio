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

/**
 * The socket registry is stored on `globalThis` rather than as a module-scoped
 * variable so that it survives Next.js Fast Refresh / HMR reloads in development.
 * Module-scoped variables are re-initialised when a module is hot-replaced, which
 * would orphan existing socket connections. `globalThis` persists across reloads.
 */
declare global {
  // eslint-disable-next-line no-var
  var __socketRegistry: Map<string, Socket> | undefined
}

/** Module-level empty map returned during SSR to avoid allocating a new Map per call. */
const SSR_EMPTY_REGISTRY = new Map<string, Socket>()

/**
 * Prune all stale (disconnected / destroyed) entries from the registry.
 * Called when the registry is accessed so that orphaned sockets from HMR
 * reloads do not accumulate.
 */
const pruneStaleEntries = (registry: Map<string, Socket>): void => {
  registry.forEach((entry, key) => {
    if (!entry.connected && !entry.active) {
      // Best-effort cleanup of the underlying socket
      try {
        entry.disconnect()
      } catch {
        // ignore — socket may already be fully torn down
      }
      registry.delete(key)
    }
  })
}

/**
 * Minimum interval (ms) between prune sweeps.
 * Development uses a shorter interval because HMR reloads create stale
 * entries more frequently. Production uses a longer interval since orphaned
 * sockets are rarer, but pruning is still necessary to avoid leaking
 * entries that were disconnected by transient network issues.
 */
const PRUNE_INTERVAL_MS = process.env.NODE_ENV === 'development' ? 30_000 : 5 * 60_000

let lastPruneTime = 0

const maybePrune = (registry: Map<string, Socket>): void => {
  const now = Date.now()
  if (now - lastPruneTime < PRUNE_INTERVAL_MS) return
  lastPruneTime = now
  pruneStaleEntries(registry)
}

const getGlobalSocketRegistry = (): Map<string, Socket> => {
  if (typeof window === 'undefined') {
    return SSR_EMPTY_REGISTRY
  }

  if (!globalThis.__socketRegistry) {
    globalThis.__socketRegistry = new Map<string, Socket>()
  }

  maybePrune(globalThis.__socketRegistry)

  return globalThis.__socketRegistry
}

export function SocketProvider({ children, user }: SocketProviderProps) {
  const pathname = usePathname()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const callbackPathnameRef = useRef(pathname)
  callbackPathnameRef.current = pathname

  // Track the socket independently of React's state updates for cleanup.
  const socketRef = useRef<Socket | null>(null)
  const userIdRef = useRef<string | undefined>(undefined)

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
    if (!user?.id) return

    // Prune registry entry for previous user on login/logout transitions
    if (userIdRef.current && userIdRef.current !== user.id) {
      const registry = getGlobalSocketRegistry()
      registry.get(userIdRef.current)?.disconnect()
      registry.delete(userIdRef.current)
    }
    userIdRef.current = user.id

    const registry = getGlobalSocketRegistry()
    const entry = registry.get(user.id)
    let setupSocketCleanup: (() => void) | undefined

    const setupSocket = (socketInstance: Socket) => {
      socketRef.current = socketInstance
      setSocket(socketInstance)

      const onConnect = () => {
        setIsConnected(true)
        setIsConnecting(false)
        logger.info('Socket connected successfully', {
          socketId: socketInstance?.id,
          connected: socketInstance?.connected,
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

      // Initial check
      if (socketInstance.connected) {
        onConnect()
      }

      return () => {
        socketInstance.off('connect', onConnect)
        socketInstance.off('disconnect', onDisconnect)
        socketInstance.off('connect_error', onConnectError)
      }
    }

    if (entry) {
      logger.info('Reusing existing shared socket connection', { userId: user.id })
      setIsConnecting(!entry.connected && entry.active)
      setupSocketCleanup = setupSocket(entry)
    } else {
      logger.info('Initializing new socket connection for user:', user.id)
      setIsConnecting(true)

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

      registry.set(user.id, socketInstance)
      setupSocketCleanup = setupSocket(socketInstance)
    }

    return () => {
      setupSocketCleanup?.()

      // Clean up socket and registry entry on unmount
      const currentSocket = socketRef.current
      if (currentSocket && user?.id) {
        logger.info('Cleaning up socket connection on unmount')
        getGlobalSocketRegistry().delete(user.id)
        currentSocket.disconnect()
        socketRef.current = null
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
