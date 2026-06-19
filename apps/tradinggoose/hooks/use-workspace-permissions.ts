'use client'

import { useCallback, useEffect } from 'react'
import type { permissionTypeEnum } from '@tradinggoose/db/schema'
import { createWithEqualityFn as create } from 'zustand/traditional'
import { handleAuthError, isAuthErrorStatus } from '@/lib/auth/auth-error-handler'
import { isSessionRecoveryAuthError } from '@/lib/auth/auth-error-copy'
import { createLogger } from '@/lib/logs/console/logger'
import { usePathname } from '@/i18n/navigation'
import { API_ENDPOINTS } from '@/stores/constants'

const logger = createLogger('useWorkspacePermissions')

export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

export interface WorkspaceUser {
  userId: string
  email: string
  name: string | null
  image: string | null
  permissionType: PermissionType
}

export interface WorkspacePermissions {
  users: WorkspaceUser[]
  total: number
  currentUserPermission: PermissionType
}

interface UseWorkspacePermissionsReturn {
  permissions: WorkspacePermissions | null
  loading: boolean
  error: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetch: () => Promise<void>
}

/**
 * Custom hook to fetch and manage workspace permissions
 *
 * @param workspaceId - The workspace ID to fetch permissions for
 * @returns Object containing permissions data, loading state, error state, and refetch function
 */
type WorkspacePermissionsRecord = {
  permissions: WorkspacePermissions | null
  loading: boolean
  error: string | null
}

interface WorkspacePermissionsStoreState {
  records: Record<string, WorkspacePermissionsRecord>
  inFlight: Partial<Record<string, Promise<void>>>
  setRecord: (recordKey: string, partial: Partial<WorkspacePermissionsRecord>) => void
  fetchPermissions: (
    recordKey: string,
    workspaceId: string,
    options: { callbackPathname: string; force?: boolean }
  ) => Promise<void>
}

const createDefaultRecord = (): WorkspacePermissionsRecord => ({
  permissions: null,
  loading: false,
  error: null,
})

const useWorkspacePermissionsStore = create<WorkspacePermissionsStoreState>((set, get) => ({
  records: {},
  inFlight: {},
  setRecord: (recordKey, partial) =>
    set((state) => {
      const prev = state.records[recordKey] ?? createDefaultRecord()
      return {
        records: {
          ...state.records,
          [recordKey]: {
            ...prev,
            ...partial,
          },
        },
      }
    }),
  fetchPermissions: async (recordKey, workspaceId, options) => {
    const { callbackPathname, force = false } = options
    const { records, inFlight, setRecord } = get()

    if (!force) {
      if (inFlight[recordKey]) {
        return inFlight[recordKey]
      }

      const existing = records[recordKey]
      if (isSessionRecoveryAuthError(existing?.error)) {
        return
      }
      if (existing?.permissions && !existing?.error) {
        return
      }
    }

    const fetchPromise = (async () => {
      try {
        setRecord(recordKey, { loading: true, error: null })

        const response = await fetch(API_ENDPOINTS.WORKSPACE_PERMISSIONS(workspaceId))

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Workspace not found or access denied')
          }
          if (isAuthErrorStatus(response.status)) {
            await handleAuthError('workspace-permissions', callbackPathname)
            setRecord(recordKey, {
              permissions: null,
              loading: false,
              error: 'SESSION_EXPIRED',
            })
            return
          }
          throw new Error(`Failed to fetch permissions: ${response.statusText}`)
        }

        const data: WorkspacePermissions = await response.json()

        logger.info('Workspace permissions loaded', {
          workspaceId,
          userCount: data.total,
          users: data.users.map((u) => ({ email: u.email, permissions: u.permissionType })),
        })

        setRecord(recordKey, {
          permissions: data,
          loading: false,
          error: null,
        })
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        logger.error('Failed to fetch workspace permissions', {
          workspaceId,
          error: errorMessage,
        })
        setRecord(recordKey, {
          loading: false,
          error: errorMessage,
        })
      } finally {
        set((state) => {
          const next = { ...state.inFlight }
          delete next[recordKey]
          return { inFlight: next }
        })
      }
    })()

    set((state) => ({
      inFlight: {
        ...state.inFlight,
        [recordKey]: fetchPromise,
      },
    }))

    await fetchPromise
  },
}))

function getRecordKey(workspaceId: string, userId: string) {
  return `${userId}:${workspaceId}`
}

export function resetWorkspacePermissionsStore() {
  useWorkspacePermissionsStore.setState({ records: {}, inFlight: {} })
}

export function useWorkspacePermissions(
  workspaceId: string,
  userId: string
): UseWorkspacePermissionsReturn {
  const callbackPathname = usePathname()
  const recordKey = getRecordKey(workspaceId, userId)
  const record = useWorkspacePermissionsStore((state) => state.records[recordKey])
  const fetchPermissions = useWorkspacePermissionsStore((state) => state.fetchPermissions)
  const setRecord = useWorkspacePermissionsStore((state) => state.setRecord)

  useEffect(() => {
    fetchPermissions(recordKey, workspaceId, { callbackPathname }).catch((error) => {
      logger.error('Failed to load workspace permissions', { workspaceId, error })
    })
  }, [workspaceId, recordKey, callbackPathname, fetchPermissions])

  const refetch = useCallback(async () => {
    await fetchPermissions(recordKey, workspaceId, { callbackPathname, force: true })
  }, [workspaceId, recordKey, callbackPathname, fetchPermissions])

  const updatePermissions = useCallback(
    (newPermissions: WorkspacePermissions) => {
      setRecord(recordKey, {
        permissions: newPermissions,
        loading: false,
        error: null,
      })
    },
    [recordKey, setRecord]
  )

  return {
    permissions: record?.permissions ?? null,
    loading: record?.loading ?? true,
    error: record?.error ?? null,
    updatePermissions,
    refetch,
  }
}
