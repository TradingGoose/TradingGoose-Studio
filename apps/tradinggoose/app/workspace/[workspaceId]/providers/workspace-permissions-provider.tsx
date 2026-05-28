'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import {
  useWorkspacePermissions,
  type WorkspacePermissions,
} from '@/hooks/use-workspace-permissions'
import { localizeHref, stripLocaleFromPathname } from '@/i18n/utils'

const logger = createLogger('WorkspacePermissionsProvider')
const ACCESS_DENIED_PATTERNS = ['access denied', 'workspace not found', 'user not found']
const AUTH_ERROR_PATTERNS = ['authentication required', 'failed to get session']

interface WorkspacePermissionsContextType {
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetchPermissions: () => Promise<void>
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }
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

export function WorkspacePermissionsProvider({
  children,
  workspaceId: workspaceIdProp,
}: WorkspacePermissionsProviderProps) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const workspaceId = workspaceIdProp ?? (params?.workspaceId as string | undefined) ?? null
  const locale = stripLocaleFromPathname(pathname ?? '/').locale

  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [hasRedirected, setHasRedirected] = useState(false)

  useEffect(() => {
    setHasRedirected(false)
  }, [workspaceId])

  const {
    permissions: workspacePermissions,
    loading: permissionsLoading,
    error: permissionsError,
    updatePermissions,
    refetch: refetchPermissions,
  } = useWorkspacePermissions(workspaceId)

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
      router.replace(localizeHref(locale, `/login?reauth=1&callbackUrl=${encodeURIComponent(callbackTarget)}`))
      return
    }

    setHasRedirected(true)
    logger.warn('Redirecting user without workspace access', {
      workspaceId,
      error: combinedError ?? 'missing read permissions',
    })
    router.replace(localizeHref(locale, '/workspace'))
  }, [combinedError, hasRedirected, isAuthError, locale, router, shouldTriggerRedirect, workspaceId])

  const shouldBlockRender = hasRedirected || shouldTriggerRedirect

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
