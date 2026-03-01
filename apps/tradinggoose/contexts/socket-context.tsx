'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useParams } from 'next/navigation'
import { io, type Socket } from 'socket.io-client'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('SocketContext')

interface User {
  id: string
  name?: string
  email?: string
}

interface PresenceUser {
  socketId: string
  userId: string
  userName: string
  cursor?: { x: number; y: number }
  selection?: { type: 'block' | 'edge' | 'none'; id?: string }
}

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  isConnecting: boolean
  currentWorkflowId: string | null
  presenceUsers: PresenceUser[]
  joinWorkflow: (workflowId: string) => void
  leaveWorkflow: () => void
  emitWorkflowOperation: (
    operation: string,
    target: string,
    payload: any,
    operationId?: string
  ) => void
  emitSubblockUpdate: (
    blockId: string,
    subblockId: string,
    value: any,
    operationId?: string
  ) => void
  emitVariableUpdate: (variableId: string, field: string, value: any, operationId?: string) => void

  emitCursorUpdate: (cursor: { x: number; y: number }) => void
  emitSelectionUpdate: (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => void
  // Event handlers for receiving real-time updates
  onWorkflowOperation: (handler: (data: any) => void) => void
  onSubblockUpdate: (handler: (data: any) => void) => void
  onVariableUpdate: (handler: (data: any) => void) => void

  onCursorUpdate: (handler: (data: any) => void) => void
  onSelectionUpdate: (handler: (data: any) => void) => void
  onUserJoined: (handler: (data: any) => void) => void
  onUserLeft: (handler: (data: any) => void) => void
  onWorkflowDeleted: (handler: (data: any) => void) => void
  onWorkflowReverted: (handler: (data: any) => void) => void
  onOperationConfirmed: (handler: (data: any) => void) => void
  onOperationFailed: (handler: (data: any) => void) => void
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  isConnecting: false,
  currentWorkflowId: null,
  presenceUsers: [],
  joinWorkflow: () => { },
  leaveWorkflow: () => { },
  emitWorkflowOperation: () => { },
  emitSubblockUpdate: () => { },
  emitVariableUpdate: () => { },
  emitCursorUpdate: () => { },
  emitSelectionUpdate: () => { },
  onWorkflowOperation: () => { },
  onSubblockUpdate: () => { },
  onVariableUpdate: () => { },
  onCursorUpdate: () => { },
  onSelectionUpdate: () => { },
  onUserJoined: () => { },
  onUserLeft: () => { },
  onWorkflowDeleted: () => { },
  onWorkflowReverted: () => { },
  onOperationConfirmed: () => { },
  onOperationFailed: () => { },
})

export const useSocket = () => useContext(SocketContext)

interface SocketProviderProps {
  children: ReactNode
  user?: User
  workspaceId?: string
  workflowId?: string
}

export function SocketProvider({
  children,
  user,
  workspaceId: workspaceIdOverride,
  workflowId: workflowIdOverride,
}: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null)
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const initializedRef = useRef(false)

  // Get current workflow ID from URL params
  const params = useParams()
  const routeWorkspaceId = params?.workspaceId as string | undefined
  const routeWorkflowId = params?.workflowId as string | undefined

  const resolvedWorkspaceId = workspaceIdOverride ?? routeWorkspaceId
  const resolvedWorkflowId = workflowIdOverride ?? routeWorkflowId

  // Use refs to store event handlers to avoid stale closures
  const eventHandlers = useRef<{
    workflowOperation?: (data: any) => void
    subblockUpdate?: (data: any) => void
    variableUpdate?: (data: any) => void

    cursorUpdate?: (data: any) => void
    selectionUpdate?: (data: any) => void
    userJoined?: (data: any) => void
    userLeft?: (data: any) => void
    workflowDeleted?: (data: any) => void
    workflowReverted?: (data: any) => void
    operationConfirmed?: (data: any) => void
    operationFailed?: (data: any) => void
  }>({})

  // Singleton socket instance management
  const socketRef = useRef<Socket | null>(null)

  // Helper function to generate a fresh socket token
  const generateSocketToken = async (): Promise<string> => {
    // Avoid overlapping token requests
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

  // Global socket registry to share connections between providers
  // Key combines userId and workflowId to allow parallel workflow streams
  type SocketRegistryEntry = {
    connection: Socket | null
    promise: Promise<Socket> | null
    refCount: number
  }

  const getGlobalSocketRegistry = () => {
    if (typeof window === 'undefined') return new Map<string, SocketRegistryEntry>()
    if (!(window as any).__socketRegistry) {
      ; (window as any).__socketRegistry = new Map<string, SocketRegistryEntry>()
    }
    return (window as any).__socketRegistry as Map<string, SocketRegistryEntry>
  }

  // Initialize socket when user is available - only once per session
  useEffect(() => {
    if (!user?.id) return

    const registry = getGlobalSocketRegistry()
    let entry = registry.get(user.id)

    let setupSocketCleanup: (() => void) | undefined
    let attachListenersCleanup: (() => void) | undefined

    const setupSocket = (socketInstance: Socket) => {
      setSocket(socketInstance)

      const onConnect = () => {
        setIsConnected(true)
        setIsConnecting(false)
        logger.info('Socket connected successfully', {
          socketId: socketInstance?.id,
          connected: socketInstance?.connected,
          workspaceId: resolvedWorkspaceId || 'unknown',
          workflowId: resolvedWorkflowId || 'none',
        })
        // Join workflow if needed
        if (resolvedWorkflowId) {
          logger.info(`Joining workflow room after connection: ${resolvedWorkflowId}`)
          socketInstance.emit('join-workflow', { workflowId: resolvedWorkflowId })
          setCurrentWorkflowId(resolvedWorkflowId)
        }
      }

      const onDisconnect = (reason: string) => {
        setIsConnected(false)
        setIsConnecting(false)
        logger.info('Socket disconnected', { reason })
        setPresenceUsers([])
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

    const attachListeners = (socketInstance: Socket) => {
      const onPresenceUpdate = (users: PresenceUser[]) => {
        setPresenceUsers(users)
      }

      const onWorkflowOperation = (data: any) => {
        if (resolvedWorkflowId && data.workflowId && data.workflowId !== resolvedWorkflowId) return
        eventHandlers.current.workflowOperation?.(data)
      }

      const onSubblockUpdate = (data: any) => {
        if (resolvedWorkflowId && data.workflowId && data.workflowId !== resolvedWorkflowId) return
        eventHandlers.current.subblockUpdate?.(data)
      }

      const onVariableUpdate = (data: any) => {
        if (resolvedWorkflowId && data.workflowId && data.workflowId !== resolvedWorkflowId) return
        eventHandlers.current.variableUpdate?.(data)
      }

      const onWorkflowDeleted = (data: any) => {
        if (resolvedWorkflowId && data.workflowId && data.workflowId !== resolvedWorkflowId) return
        logger.warn(`Workflow ${data.workflowId} has been deleted`)
        if (currentWorkflowId === data.workflowId) {
          setCurrentWorkflowId(null)
          setPresenceUsers([])
        }
        eventHandlers.current.workflowDeleted?.(data)
      }

      const onWorkflowReverted = (data: any) => {
        if (resolvedWorkflowId && data.workflowId && data.workflowId !== resolvedWorkflowId) return
        logger.info(`Workflow ${data.workflowId} has been reverted to deployed state`)
        eventHandlers.current.workflowReverted?.(data)
      }

      const onWorkflowUpdated = (data: any) => {
        if (resolvedWorkflowId && data.workflowId && data.workflowId !== resolvedWorkflowId) return
        logger.info(`Workflow ${data.workflowId} has been updated externally - requesting sync`)
        if (data.workflowId === resolvedWorkflowId) {
          socketInstance?.emit('request-sync', { workflowId: data.workflowId })
        }
      }

      const onCopilotWorkflowEdit = async (data: any) => {
        if (resolvedWorkflowId && data.workflowId && data.workflowId !== resolvedWorkflowId) return
        logger.info(`Copilot edited workflow ${data.workflowId} - rehydrating stores`)
        try {
          const response = await fetch(`/api/workflows/${data.workflowId}`)
          if (response.ok) {
            const responseData = await response.json()
            if (responseData.data?.state) {
              // We need to dynamically import stores as in original
              const [
                { useOperationQueueStore },
                { useWorkflowRegistry },
                { useWorkflowStore },
                { useSubBlockStore },
              ] = await Promise.all([
                import('@/stores/operation-queue/store'),
                import('@/stores/workflows/registry/store'),
                import('@/stores/workflows/workflow/store-client'),
                import('@/stores/workflows/subblock/store'),
              ])

              useWorkflowStore.setState({
                blocks: responseData.data.state.blocks || {},
                edges: responseData.data.state.edges || [],
                loops: responseData.data.state.loops || {},
                parallels: responseData.data.state.parallels || {},
                lastSaved: responseData.data.state.lastSaved || Date.now(),
                isDeployed: responseData.data.state.isDeployed ?? false,
                deployedAt: responseData.data.state.deployedAt,
                deploymentStatuses: responseData.data.state.deploymentStatuses || {},
              })

              // Replace subblock store values for this workflow
              const subblockValues: Record<string, Record<string, any>> = {}
              Object.entries(responseData.data.state.blocks || {}).forEach(([blockId, block]) => {
                const blockState = block as any
                subblockValues[blockId] = {}
                Object.entries(blockState.subBlocks || {}).forEach(([subblockId, subblock]) => {
                  subblockValues[blockId][subblockId] = (subblock as any).value
                })
              })

              useSubBlockStore.setState((state: any) => ({
                workflowValues: {
                  ...state.workflowValues,
                  [data.workflowId]: subblockValues,
                },
              }))
            }
          }
        } catch (e) {
          logger.error('Error rehydrating', e)
        }
      }

      const onCursorUpdate = (data: any) => {
        setPresenceUsers((prev) =>
          prev.map((user) =>
            user.socketId === data.socketId ? { ...user, cursor: data.cursor } : user
          )
        )
        eventHandlers.current.cursorUpdate?.(data)
      }

      const onSelectionUpdate = (data: any) => {
        setPresenceUsers((prev) =>
          prev.map((user) =>
            user.socketId === data.socketId ? { ...user, selection: data.selection } : user
          )
        )
        eventHandlers.current.selectionUpdate?.(data)
      }

      const onOperationConfirmed = (data: any) => {
        eventHandlers.current.operationConfirmed?.(data)
      }

      const onOperationFailed = (data: any) => {
        eventHandlers.current.operationFailed?.(data)
      }

      // Attach listeners
      socketInstance.on('presence-update', onPresenceUpdate)
      socketInstance.on('workflow-operation', onWorkflowOperation)
      socketInstance.on('subblock-update', onSubblockUpdate)
      socketInstance.on('variable-update', onVariableUpdate)
      socketInstance.on('workflow-deleted', onWorkflowDeleted)
      socketInstance.on('workflow-reverted', onWorkflowReverted)
      socketInstance.on('workflow-updated', onWorkflowUpdated)
      socketInstance.on('copilot-workflow-edit', onCopilotWorkflowEdit)
      socketInstance.on('cursor-update', onCursorUpdate)
      socketInstance.on('selection-update', onSelectionUpdate)
      socketInstance.on('operation-confirmed', onOperationConfirmed)
      socketInstance.on('operation-failed', onOperationFailed)

      return () => {
        socketInstance.off('presence-update', onPresenceUpdate)
        socketInstance.off('workflow-operation', onWorkflowOperation)
        socketInstance.off('subblock-update', onSubblockUpdate)
        socketInstance.off('variable-update', onVariableUpdate)
        socketInstance.off('workflow-deleted', onWorkflowDeleted)
        socketInstance.off('workflow-reverted', onWorkflowReverted)
        socketInstance.off('workflow-updated', onWorkflowUpdated)
        socketInstance.off('copilot-workflow-edit', onCopilotWorkflowEdit)
        socketInstance.off('cursor-update', onCursorUpdate)
        socketInstance.off('selection-update', onSelectionUpdate)
        socketInstance.off('operation-confirmed', onOperationConfirmed)
        socketInstance.off('operation-failed', onOperationFailed)
      }
    }

    if (entry) {
      // Socket already exists or is being created
      if (entry.promise) {
        logger.info('Waiting for shared socket initialization', { userId: user.id })
        setIsConnecting(true)
        entry.promise.then((socket) => {
          const current = registry.get(user.id)
          if (current) {
            registry.set(user.id, {
              ...current,
              connection: socket,
              promise: null,
            })
          }
          setupSocketCleanup = setupSocket(socket)
          attachListenersCleanup = attachListeners(socket)
        }).catch((err) => {
          logger.error('Shared socket initialization failed', err)
          setIsConnecting(false)
          registry.delete(user.id) // Allow retry
        })
      } else if (entry.connection) {
        logger.info('Reusing existing shared socket connection', { userId: user.id })
        setupSocketCleanup = setupSocket(entry.connection)
        attachListenersCleanup = attachListeners(entry.connection)
      }
    } else {
      // Initialize new socket
      logger.info('Initializing new socket connection for user:', user.id)
      setIsConnecting(true)

      const initPromise = (async () => {
        try {
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
        } catch (e) {
          throw e
        }
      })()

      registry.set(user.id, {
        connection: null,
        promise: initPromise,
        refCount: 1,
      })

      initPromise.then((socket) => {
        const current = registry.get(user.id)
        registry.set(user.id, {
          connection: socket,
          promise: null,
          refCount: current?.refCount ?? 1,
        })
        setupSocketCleanup = setupSocket(socket)
        attachListenersCleanup = attachListeners(socket)
      }).catch((err) => {
        logger.error('Failed to initialize socket:', err)
        setIsConnecting(false)
        registry.delete(user.id)
      })
    }

    return () => {
      setupSocketCleanup?.()
      attachListenersCleanup?.()

      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()
    }
  }, [user?.id, resolvedWorkflowId])

  // Handle workflow room switching when URL changes (for navigation between workflows)
  useEffect(() => {
    if (!socket || !isConnected || !resolvedWorkflowId) return

    // If we're already in the correct workflow room, no need to switch
    if (currentWorkflowId === resolvedWorkflowId) return

    logger.info(
      `URL workflow changed from ${currentWorkflowId} to ${resolvedWorkflowId} (workspace: ${resolvedWorkspaceId || 'unknown'}), switching rooms`
    )

    // Leave current workflow first if we're in one
    if (currentWorkflowId) {
      logger.info(
        `Leaving current workflow ${currentWorkflowId} before joining ${resolvedWorkflowId}`
      )
      socket.emit('leave-workflow')
    }

    // Join the new workflow room
    logger.info(`Joining workflow room: ${resolvedWorkflowId}`)
    socket.emit('join-workflow', {
      workflowId: resolvedWorkflowId,
    })
    setCurrentWorkflowId(resolvedWorkflowId)
  }, [socket, isConnected, resolvedWorkflowId, currentWorkflowId])

  // Cleanup socket on component unmount
  useEffect(() => {
    return () => {
      if (socket) {
        logger.info('Cleaning up socket connection on unmount')
        socket.disconnect()
      }
    }
  }, [])

  // Join workflow room
  const joinWorkflow = useCallback(
    (workflowId: string) => {
      if (!socket || !user?.id) {
        logger.warn('Cannot join workflow: socket or user not available')
        return
      }

      // Prevent duplicate joins to the same workflow
      if (currentWorkflowId === workflowId) {
        logger.info(`Already in workflow ${workflowId}, skipping join`)
        return
      }

      // Leave current workflow first if we're in one
      if (currentWorkflowId) {
        logger.info(`Leaving current workflow ${currentWorkflowId} before joining ${workflowId}`)
        socket.emit('leave-workflow')
      }

      logger.info(`Joining workflow: ${workflowId}`)
      socket.emit('join-workflow', {
        workflowId, // Server gets user info from authenticated session
      })
      setCurrentWorkflowId(workflowId)
    },
    [socket, user, currentWorkflowId]
  )

  // Leave current workflow room
  const leaveWorkflow = useCallback(() => {
    if (socket && currentWorkflowId) {
      logger.info(`Leaving workflow: ${currentWorkflowId}`)
      try {
        const { useOperationQueueStore } = require('@/stores/operation-queue/store')
        useOperationQueueStore.getState().cancelOperationsForWorkflow(currentWorkflowId)
      } catch { }
      socket.emit('leave-workflow')
      setCurrentWorkflowId(null)
      setPresenceUsers([])

      // Clean up any pending position updates
      positionUpdateTimeouts.current.forEach((timeoutId) => {
        clearTimeout(timeoutId)
      })
      positionUpdateTimeouts.current.clear()
      pendingPositionUpdates.current.clear()
    }
  }, [socket, currentWorkflowId])

  // Light throttling for position updates to ensure smooth collaborative movement
  const positionUpdateTimeouts = useRef<Map<string, number>>(new Map())
  const pendingPositionUpdates = useRef<Map<string, any>>(new Map())

  // Emit workflow operations (blocks, edges, subflows)
  const emitWorkflowOperation = useCallback(
    (operation: string, target: string, payload: any, operationId?: string) => {
      if (!socket || !currentWorkflowId) {
        return
      }

      // Apply light throttling only to position updates for smooth collaborative experience
      const isPositionUpdate = operation === 'update-position' && target === 'block'
      const { commit = true } = payload || {}

      if (isPositionUpdate && payload.id) {
        const blockId = payload.id

        if (commit) {
          socket.emit('workflow-operation', {
            operation,
            target,
            payload,
            timestamp: Date.now(),
            operationId,
          })
          pendingPositionUpdates.current.delete(blockId)
          const timeoutId = positionUpdateTimeouts.current.get(blockId)
          if (timeoutId) {
            clearTimeout(timeoutId)
            positionUpdateTimeouts.current.delete(blockId)
          }
          return
        }

        pendingPositionUpdates.current.set(blockId, {
          operation,
          target,
          payload,
          timestamp: Date.now(),
          operationId,
        })

        if (!positionUpdateTimeouts.current.has(blockId)) {
          const timeoutId = window.setTimeout(() => {
            const latestUpdate = pendingPositionUpdates.current.get(blockId)
            if (latestUpdate) {
              socket.emit('workflow-operation', latestUpdate)
              pendingPositionUpdates.current.delete(blockId)
            }
            positionUpdateTimeouts.current.delete(blockId)
          }, 33)

          positionUpdateTimeouts.current.set(blockId, timeoutId)
        }
      } else {
        // For all non-position updates, emit immediately
        socket.emit('workflow-operation', {
          operation,
          target,
          payload,
          timestamp: Date.now(),
          operationId, // Include operation ID for queue tracking
        })
      }
    },
    [socket, currentWorkflowId]
  )

  // Emit subblock value updates
  const emitSubblockUpdate = useCallback(
    (blockId: string, subblockId: string, value: any, operationId?: string) => {
      // Only emit if socket is connected and we're in a valid workflow room
      if (socket && currentWorkflowId) {
        socket.emit('subblock-update', {
          blockId,
          subblockId,
          value,
          timestamp: Date.now(),
          operationId, // Include operation ID for queue tracking
        })
      } else {
        logger.warn('Cannot emit subblock update: no socket connection or workflow room', {
          hasSocket: !!socket,
          currentWorkflowId,
          blockId,
          subblockId,
        })
      }
    },
    [socket, currentWorkflowId]
  )

  // Emit variable value updates
  const emitVariableUpdate = useCallback(
    (variableId: string, field: string, value: any, operationId?: string) => {
      // Only emit if socket is connected and we're in a valid workflow room
      if (socket && currentWorkflowId) {
        socket.emit('variable-update', {
          variableId,
          field,
          value,
          timestamp: Date.now(),
          operationId, // Include operation ID for queue tracking
        })
      } else {
        logger.warn('Cannot emit variable update: no socket connection or workflow room', {
          hasSocket: !!socket,
          currentWorkflowId,
          variableId,
          field,
        })
      }
    },
    [socket, currentWorkflowId]
  )

  // Cursor throttling optimized for database connection health
  const lastCursorEmit = useRef(0)
  const emitCursorUpdate = useCallback(
    (cursor: { x: number; y: number }) => {
      if (socket && currentWorkflowId) {
        const now = performance.now()
        // Reduced to 30fps (33ms) to reduce database load while maintaining smooth UX
        if (now - lastCursorEmit.current >= 33) {
          socket.emit('cursor-update', { cursor })
          lastCursorEmit.current = now
        }
      }
    },
    [socket, currentWorkflowId]
  )

  // Emit selection updates
  const emitSelectionUpdate = useCallback(
    (selection: { type: 'block' | 'edge' | 'none'; id?: string }) => {
      if (socket && currentWorkflowId) {
        socket.emit('selection-update', { selection })
      }
    },
    [socket, currentWorkflowId]
  )

  // Event handler registration functions
  const onWorkflowOperation = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowOperation = handler
  }, [])

  const onSubblockUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.subblockUpdate = handler
  }, [])

  const onVariableUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.variableUpdate = handler
  }, [])

  const onCursorUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.cursorUpdate = handler
  }, [])

  const onSelectionUpdate = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.selectionUpdate = handler
  }, [])

  const onUserJoined = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.userJoined = handler
  }, [])

  const onUserLeft = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.userLeft = handler
  }, [])

  const onWorkflowDeleted = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowDeleted = handler
  }, [])

  const onWorkflowReverted = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.workflowReverted = handler
  }, [])

  const onOperationConfirmed = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.operationConfirmed = handler
  }, [])

  const onOperationFailed = useCallback((handler: (data: any) => void) => {
    eventHandlers.current.operationFailed = handler
  }, [])

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        isConnecting,
        currentWorkflowId,
        presenceUsers,
        joinWorkflow,
        leaveWorkflow,
        emitWorkflowOperation,
        emitSubblockUpdate,
        emitVariableUpdate,

        emitCursorUpdate,
        emitSelectionUpdate,
        onWorkflowOperation,
        onSubblockUpdate,
        onVariableUpdate,

        onCursorUpdate,
        onSelectionUpdate,
        onUserJoined,
        onUserLeft,
        onWorkflowDeleted,
        onWorkflowReverted,
        onOperationConfirmed,
        onOperationFailed,
      }}
    >
      {children}
    </SocketContext.Provider>
  )
}
