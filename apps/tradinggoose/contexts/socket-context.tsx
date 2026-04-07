'use client'

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { io, type Socket } from 'socket.io-client'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SocketContext')

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

type SocketRegistryEntry = {
  connection: Socket | null
  promise: Promise<Socket> | null
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

/** Module-level empty map returned during SSR to avoid allocating a new Map per call. */
const SSR_EMPTY_REGISTRY = new Map<string, SocketRegistryEntry>()

const isEntryAlive = (entry: SocketRegistryEntry): boolean => {
  if (!entry.connection) {
    // Entry is still initialising (has a pending promise) — treat as alive
    return entry.promise !== null
  }
  // A socket that has been `.disconnect()`-ed or whose transport has been
  // destroyed is stale and should be evicted.
  return entry.connection.connected || entry.connection.active
}

/**
 * Prune all stale (disconnected / destroyed) entries from the registry.
 * Called when the registry is accessed so that orphaned sockets from HMR
 * reloads do not accumulate.
 */
const pruneStaleEntries = (
  registry: Map<string, SocketRegistryEntry>
): void => {
  registry.forEach((entry, key) => {
    if (!isEntryAlive(entry)) {
      // Best-effort cleanup of the underlying socket
      try {
        entry.connection?.disconnect()
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
const PRUNE_INTERVAL_MS =
  process.env.NODE_ENV === 'development' ? 30_000 : 5 * 60_000

let lastPruneTime = 0

const maybePrune = (registry: Map<string, SocketRegistryEntry>): void => {
  const now = Date.now()
  if (now - lastPruneTime < PRUNE_INTERVAL_MS) return
  lastPruneTime = now
  pruneStaleEntries(registry)
}

const getGlobalSocketRegistry = (): Map<string, SocketRegistryEntry> => {
  if (typeof window === 'undefined') {
    return SSR_EMPTY_REGISTRY
  }

  if (!globalThis.__socketRegistry) {
    globalThis.__socketRegistry = new Map<string, SocketRegistryEntry>()
  }

  maybePrune(globalThis.__socketRegistry)

  return globalThis.__socketRegistry
}

export function SocketProvider({ children, user }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  // Track socket in a ref so the cleanup closure always sees the latest value,
  // avoiding the race where `socket` state is still null during fast unmount.
  const socketRef = useRef<Socket | null>(null)
  const userIdRef = useRef<string | undefined>(undefined)

  // Helper function to generate a fresh socket token
  const generateSocketToken = async (): Promise<string> => {
    const res = await fetch('/api/auth/socket-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'cache-control': 'no-store' },
    })

    if (!res.ok) throw new Error('Failed to generate socket token')
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
      const prev = registry.get(userIdRef.current)
      if (prev?.connection) {
        prev.connection.disconnect()
      }
      registry.delete(userIdRef.current)
    }
    userIdRef.current = user.id

    const registry = getGlobalSocketRegistry()
    let entry = registry.get(user.id)
    let disposed = false

    let setupSocketCleanup: (() => void) | undefined

    const setupSocket = (socketInstance: Socket) => {
      if (disposed) return
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
        setIsConnecting(false)
        logger.error('Socket connection error:', {
          message: error.message,
          type: error.type,
        })
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
      if (entry.promise) {
        logger.info('Waiting for shared socket initialization', { userId: user.id })
        setIsConnecting(true)
        entry.promise.then((socket) => {
          if (disposed) return
          const current = registry.get(user.id)
          if (current) {
            registry.set(user.id, {
              ...current,
              connection: socket,
              promise: null,
            })
          }
          setupSocketCleanup = setupSocket(socket)
        }).catch((err) => {
          logger.error('Shared socket initialization failed', err)
          if (!disposed) setIsConnecting(false)
          registry.delete(user.id) // Allow retry
        })
      } else if (entry.connection) {
        logger.info('Reusing existing shared socket connection', { userId: user.id })
        setupSocketCleanup = setupSocket(entry.connection)
      }
    } else {
      logger.info('Initializing new socket connection for user:', user.id)
      setIsConnecting(true)

      const initPromise = (async () => {
        const token = await generateSocketToken()
        const socketUrl = getEnv('NEXT_PUBLIC_SOCKET_URL') || 'http://localhost:3002'

        logger.info('Attempting to connect to Socket.IO server', {
          url: socketUrl,
          userId: user?.id || 'no-user',
          hasToken: !!token,
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
              logger.error('Failed to generate fresh token for connection:', error)
              cb({ token: null })
            }
          },
        })

        return socketInstance
      })()

      registry.set(user.id, {
        connection: null,
        promise: initPromise,
      })

      initPromise.then((socket) => {
        if (disposed) {
          // Component unmounted before socket was ready — clean up immediately
          socket.disconnect()
          registry.delete(user.id)
          return
        }
        registry.set(user.id, {
          connection: socket,
          promise: null,
        })
        setupSocketCleanup = setupSocket(socket)
      }).catch((err) => {
        logger.error('Failed to initialize socket:', err)
        if (!disposed) setIsConnecting(false)
        registry.delete(user.id)
      })
    }

    return () => {
      disposed = true
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
