'use client'

import { useCallback, useEffect } from 'react'
import type { permissionTypeEnum } from '@sim/db/schema'
import { create } from 'zustand'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { createLogger } from '@/lib/logs/console/logger'
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
  inFlight: Record<string, Promise<void>>
  setRecord: (workspaceId: string, partial: Partial<WorkspacePermissionsRecord>) => void
  fetchPermissions: (workspaceId: string, options?: { force?: boolean }) => Promise<void>
}

const createDefaultRecord = (): WorkspacePermissionsRecord => ({
  permissions: null,
  loading: false,
  error: null,
})

const useWorkspacePermissionsStore = create<WorkspacePermissionsStoreState>((set, get) => ({
  records: {},
  inFlight: {},
  setRecord: (workspaceId, partial) =>
    set((state) => {
      const prev = state.records[workspaceId] ?? createDefaultRecord()
      return {
        records: {
          ...state.records,
          [workspaceId]: {
            ...prev,
            ...partial,
          },
        },
      }
    }),
  fetchPermissions: async (workspaceId, options) => {
    const { force = false } = options ?? {}
    const { records, inFlight, setRecord } = get()

    if (!force) {
      if (inFlight[workspaceId]) {
        return inFlight[workspaceId]
      }

      const existing = records[workspaceId]
      if (existing?.permissions && !existing?.error) {
        return
      }
    }

    const fetchPromise = (async () => {
      try {
        setRecord(workspaceId, { loading: true, error: null })

        const response = await fetch(API_ENDPOINTS.WORKSPACE_PERMISSIONS(workspaceId))

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Workspace not found or access denied')
          }
          if (response.status === 401) {
            await handleAuthError('workspace-permissions')
            throw new Error('Authentication required')
          }
          throw new Error(`Failed to fetch permissions: ${response.statusText}`)
        }

        const data: WorkspacePermissions = await response.json()

        logger.info('Workspace permissions loaded', {
          workspaceId,
          userCount: data.total,
          users: data.users.map((u) => ({ email: u.email, permissions: u.permissionType })),
        })

        setRecord(workspaceId, {
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
        setRecord(workspaceId, {
          loading: false,
          error: errorMessage,
        })
      } finally {
        set((state) => {
          const next = { ...state.inFlight }
          delete next[workspaceId]
          return { inFlight: next }
        })
      }
    })()

    set((state) => ({
      inFlight: {
        ...state.inFlight,
        [workspaceId]: fetchPromise,
      },
    }))

    await fetchPromise
  },
}))

export function useWorkspacePermissions(workspaceId: string | null): UseWorkspacePermissionsReturn {
  const record = useWorkspacePermissionsStore((state) =>
    workspaceId ? state.records[workspaceId] : undefined
  )
  const fetchPermissions = useWorkspacePermissionsStore((state) => state.fetchPermissions)
  const setRecord = useWorkspacePermissionsStore((state) => state.setRecord)

  useEffect(() => {
    if (!workspaceId) {
      return () => {}
    }
    fetchPermissions(workspaceId).catch((error) => {
      logger.error('Failed to load workspace permissions', { workspaceId, error })
    })
  }, [workspaceId, fetchPermissions])

  const refetch = useCallback(async () => {
    if (!workspaceId) return
    await fetchPermissions(workspaceId, { force: true })
  }, [workspaceId, fetchPermissions])

  const updatePermissions = useCallback(
    (newPermissions: WorkspacePermissions) => {
      if (!workspaceId) return
      setRecord(workspaceId, {
        permissions: newPermissions,
        loading: false,
        error: null,
      })
    },
    [workspaceId, setRecord]
  )

  return {
    permissions: record?.permissions ?? null,
    loading: record?.loading ?? false,
    error: record?.error ?? null,
    updatePermissions,
    refetch,
  }
}
