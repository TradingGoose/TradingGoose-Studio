'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { isSessionRecoveryAuthError } from '@/lib/auth/auth-error-copy'
import { useSession } from '@/lib/auth-client'
import { isSessionReadyForAuthenticatedUser } from '@/lib/session/session-context'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import {
  useWorkspacePermissions,
  type WorkspacePermissions,
} from '@/hooks/use-workspace-permissions'
import { useRouter } from '@/i18n/navigation'

const logger = createLogger('WorkspacePermissionsProvider')
const ACCESS_DENIED_PATTERNS = ['access denied', 'workspace not found', 'user not found']

interface WorkspacePermissionsContextType {
  authReady: boolean
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetchPermissions: () => Promise<void>
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }
  setOfflineMode: (isOffline: boolean) => void
}

const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType | null>(null)

interface WorkspacePermissionsProviderProps {
  children: React.ReactNode
  workspaceId: string
  userId: string
}

export function WorkspacePermissionsProvider({
  children,
  workspaceId,
  userId,
}: WorkspacePermissionsProviderProps) {
  const router = useRouter()
  const session = useSession()

  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [redirectedAccessKey, setRedirectedAccessKey] = useState<string | null>(null)
  const accessKey = `${userId}:${workspaceId}`
  const hasRedirected = redirectedAccessKey === accessKey
  const isClientAuthReady = isSessionReadyForAuthenticatedUser(session, userId)

  const {
    permissions: workspacePermissions,
    loading: permissionsLoading,
    error: permissionsError,
    updatePermissions,
    refetch: refetchPermissions,
  } = useWorkspacePermissions(workspaceId, userId, { authReady: isClientAuthReady })

  const baseUserPermissions = useUserPermissions(
    workspacePermissions,
    permissionsLoading,
    permissionsError
  )

  const userPermissions = useMemo((): WorkspaceUserPermissions & { isOfflineMode?: boolean } => {
    if (isOfflineMode) {
      return {
        ...baseUserPermissions,
        canEdit: false,
        canAdmin: false,
        canRead: baseUserPermissions.canRead,
        isOfflineMode: true,
      }
    }

    return {
      ...baseUserPermissions,
      isOfflineMode: false,
    }
  }, [baseUserPermissions, isOfflineMode])

  const contextValue = useMemo(
    () => ({
      authReady: isClientAuthReady,
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
      setOfflineMode: setIsOfflineMode,
    }),
    [
      isClientAuthReady,
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
    ]
  )

  const combinedError = userPermissions.error || permissionsError
  const isAuthRecoveryError = isSessionRecoveryAuthError(permissionsError)
  const normalizedError = combinedError?.toLowerCase() ?? ''
  const isAccessDeniedError = normalizedError
    ? ACCESS_DENIED_PATTERNS.some((pattern) => normalizedError.includes(pattern))
    : false
  const shouldTriggerRedirect = Boolean(
    workspaceId &&
      !isAuthRecoveryError &&
      !permissionsLoading &&
      !userPermissions.isLoading &&
      (isAccessDeniedError || !userPermissions.canRead)
  )

  useEffect(() => {
    if (!shouldTriggerRedirect || hasRedirected) {
      return
    }

    setRedirectedAccessKey(accessKey)
    logger.warn('Redirecting user without workspace access', {
      workspaceId,
      error: combinedError ?? 'missing read permissions',
    })
    router.replace('/workspace')
  }, [accessKey, combinedError, hasRedirected, router, shouldTriggerRedirect, workspaceId])

  const shouldBlockRender = isAuthRecoveryError || hasRedirected || shouldTriggerRedirect

  return (
    <WorkspacePermissionsContext.Provider value={contextValue}>
      {shouldBlockRender ? null : children}
    </WorkspacePermissionsContext.Provider>
  )
}

export function useWorkspacePermissionsContext(): WorkspacePermissionsContextType {
  const context = useContext(WorkspacePermissionsContext)
  if (!context) {
    throw new Error(
      'useWorkspacePermissionsContext must be used within a WorkspacePermissionsProvider'
    )
  }
  return context
}

export function useUserPermissionsContext(): WorkspaceUserPermissions & {
  isOfflineMode?: boolean
} {
  const { userPermissions } = useWorkspacePermissionsContext()
  return userPermissions
}
