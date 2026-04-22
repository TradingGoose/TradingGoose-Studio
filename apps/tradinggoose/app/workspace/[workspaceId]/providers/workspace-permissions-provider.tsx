'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import {
  useWorkspacePermissions,
  type WorkspacePermissions,
} from '@/hooks/use-workspace-permissions'

const logger = createLogger('WorkspacePermissionsProvider')
const ACCESS_DENIED_PATTERNS = ['access denied', 'workspace not found', 'user not found']
const AUTH_ERROR_PATTERNS = ['authentication required', 'failed to get session']

interface WorkspacePermissionsContextType {
  // Raw workspace permissions data
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetchPermissions: () => Promise<void>

  // Computed user permissions (connection-aware)
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }

  // Connection state management
  setOfflineMode: (isOffline: boolean) => void
}

const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType>({
  workspacePermissions: null,
  permissionsLoading: false,
  permissionsError: null,
  updatePermissions: () => {},
  refetchPermissions: async () => {},
  userPermissions: {
    canRead: false,
    canEdit: false,
    canAdmin: false,
    userPermissions: 'read',
    isLoading: false,
    error: null,
  },
  setOfflineMode: () => {},
})

interface WorkspacePermissionsProviderProps {
  children: React.ReactNode
  workspaceId?: string
}

/**
 * Provider that manages workspace permissions and user access
 * Also provides connection-aware permissions that enforce read-only mode when offline
 */
export function WorkspacePermissionsProvider({
  children,
  workspaceId: workspaceIdProp,
}: WorkspacePermissionsProviderProps) {
  const params = useParams()
  const router = useRouter()
  const workspaceId = workspaceIdProp ?? (params?.workspaceId as string | undefined) ?? null

  // Manage offline mode state locally
  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [hasRedirected, setHasRedirected] = useState(false)

  useEffect(() => {
    setHasRedirected(false)
  }, [workspaceId])

  // Fetch workspace permissions and loading state
  const {
    permissions: workspacePermissions,
    loading: permissionsLoading,
    error: permissionsError,
    updatePermissions,
    refetch: refetchPermissions,
  } = useWorkspacePermissions(workspaceId)

  // Get base user permissions from workspace permissions
  const baseUserPermissions = useUserPermissions(
    workspacePermissions,
    permissionsLoading,
    permissionsError
  )

  // Create connection-aware permissions that override user permissions when offline
  const userPermissions = useMemo((): WorkspaceUserPermissions & { isOfflineMode?: boolean } => {
    if (isOfflineMode) {
      // In offline mode, force read-only permissions regardless of actual user permissions
      return {
        ...baseUserPermissions,
        canEdit: false,
        canAdmin: false,
        // Keep canRead true so users can still view content
        canRead: baseUserPermissions.canRead,
        isOfflineMode: true,
      }
    }

    // When online, use normal permissions
    return {
      ...baseUserPermissions,
      isOfflineMode: false,
    }
  }, [baseUserPermissions, isOfflineMode])

  const contextValue = useMemo(
    () => ({
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
      setOfflineMode: setIsOfflineMode,
    }),
    [
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
    ]
  )

  const combinedError = userPermissions.error || permissionsError
  const normalizedError = combinedError?.toLowerCase() ?? ''
  const isAccessDeniedError = normalizedError
    ? ACCESS_DENIED_PATTERNS.some((pattern) => normalizedError.includes(pattern))
    : false
  const isAuthError = normalizedError
    ? AUTH_ERROR_PATTERNS.some((pattern) => normalizedError.includes(pattern))
    : false
  const shouldTriggerRedirect = Boolean(
    workspaceId &&
      !permissionsLoading &&
      !userPermissions.isLoading &&
      (isAuthError || isAccessDeniedError || !userPermissions.canRead)
  )

  useEffect(() => {
    if (!shouldTriggerRedirect || hasRedirected) {
      return
    }

    if (isAuthError) {
      const callbackTarget =
        typeof window === 'undefined'
          ? `/workspace/${workspaceId}/dashboard`
          : `${window.location.pathname}${window.location.search}`

      setHasRedirected(true)
      logger.warn('Redirecting unauthenticated user from protected workspace route', {
        workspaceId,
        error: combinedError ?? 'missing session',
      })
      router.replace(`/login?reauth=1&callbackUrl=${encodeURIComponent(callbackTarget)}`)
      return
    }

    setHasRedirected(true)
    logger.warn('Redirecting user without workspace access', {
      workspaceId,
      error: combinedError ?? 'missing read permissions',
    })
    router.replace('/workspace')
  }, [combinedError, hasRedirected, isAuthError, router, shouldTriggerRedirect, workspaceId])

  const shouldBlockRender = hasRedirected || shouldTriggerRedirect

  return (
    <WorkspacePermissionsContext.Provider value={contextValue}>
      {shouldBlockRender ? null : children}
    </WorkspacePermissionsContext.Provider>
  )
}

/**
 * Hook to access workspace permissions and data from context
 * This provides both raw workspace permissions and computed user permissions
 */
export function useWorkspacePermissionsContext(): WorkspacePermissionsContextType {
  const context = useContext(WorkspacePermissionsContext)
  if (!context) {
    throw new Error(
      'useWorkspacePermissionsContext must be used within a WorkspacePermissionsProvider'
    )
  }
  return context
}

/**
 * Hook to access user permissions from context
 * This replaces individual useUserPermissions calls and includes connection-aware permissions
 */
export function useUserPermissionsContext(): WorkspaceUserPermissions & {
  isOfflineMode?: boolean
} {
  const { userPermissions } = useWorkspacePermissionsContext()
  return userPermissions
}
