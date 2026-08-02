'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { isSessionRecoveryAuthError } from '@/lib/auth/auth-error-copy'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import {
  useWorkspacePermissions,
  type WorkspacePermissions,
} from '@/hooks/use-workspace-permissions'
import { useRouter } from '@/i18n/navigation'

const logger = createLogger('WorkspacePermissionsProvider')
const ACCESS_DENIED_PATTERNS = ['access denied', 'workspace not found', 'user not found']

interface WorkspacePermissionsContextType {
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetchPermissions: () => Promise<void>
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }
  setOfflineMode: (isOffline: boolean) => void
}

const WorkspaceAuthenticatedUserContext = createContext<string | null>(null)
const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType | null>(null)

type WorkspacePermissionsProviderProps = {
  children: React.ReactNode
  workspaceId: string
} & ({ userId: string; inheritUser?: never } | { inheritUser: true; userId?: never })

export function WorkspacePermissionsProvider(props: WorkspacePermissionsProviderProps) {
  const { children, workspaceId } = props
  const inheritedUserId = useContext(WorkspaceAuthenticatedUserContext)
  const workspaceUserId = props.userId ?? inheritedUserId

  if (!workspaceUserId) {
    throw new Error(
      'WorkspacePermissionsProvider requires userId or inheritUser inside an existing WorkspacePermissionsProvider'
    )
  }

  return (
    <WorkspacePermissionsProviderInner workspaceId={workspaceId} userId={workspaceUserId}>
      {children}
    </WorkspacePermissionsProviderInner>
  )
}

function WorkspacePermissionsProviderInner({
  children,
  workspaceId,
  userId,
}: {
  children: React.ReactNode
  workspaceId: string
  userId: string
}) {
  const router = useRouter()
  const t = useTranslations('workspace.permissionsFeedback')

  const [isOfflineMode, setIsOfflineMode] = useState(false)
  const [redirectedAccessKey, setRedirectedAccessKey] = useState<string | null>(null)
  const accessKey = `${userId}:${workspaceId}`
  const hasRedirected = redirectedAccessKey === accessKey

  const {
    permissions: workspacePermissions,
    loading: permissionsLoading,
    error: permissionsError,
    updatePermissions,
    refetch: refetchPermissions,
  } = useWorkspacePermissions(workspaceId, userId)

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
  const isAuthRecoveryError = isSessionRecoveryAuthError(permissionsError)
  const normalizedError = combinedError?.toLowerCase() ?? ''
  const isAccessDeniedError = normalizedError
    ? ACCESS_DENIED_PATTERNS.some((pattern) => normalizedError.includes(pattern))
    : false
  const isPermissionLoadFailure = Boolean(
    permissionsError && !isAuthRecoveryError && !isAccessDeniedError
  )
  const shouldTriggerRedirect = Boolean(
    workspaceId &&
      !isAuthRecoveryError &&
      !permissionsLoading &&
      !userPermissions.isLoading &&
      (isAccessDeniedError || (!combinedError && !userPermissions.canRead))
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
    <WorkspaceAuthenticatedUserContext.Provider value={userId}>
      <WorkspacePermissionsContext.Provider value={contextValue}>
        {shouldBlockRender ? null : isPermissionLoadFailure ? (
          <Alert variant='destructive' role='alert' aria-atomic='true' className='m-4'>
            <AlertTitle>{t('title')}</AlertTitle>
            <AlertDescription>{t('description')}</AlertDescription>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='mt-3'
              disabled={permissionsLoading}
              focusableWhenDisabled={permissionsLoading}
              aria-busy={permissionsLoading || undefined}
              onClick={() => {
                void refetchPermissions()
              }}
            >
              {permissionsLoading ? t('retrying') : t('retry')}
            </Button>
          </Alert>
        ) : (
          children
        )}
      </WorkspacePermissionsContext.Provider>
    </WorkspaceAuthenticatedUserContext.Provider>
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
