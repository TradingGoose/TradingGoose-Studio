import { useMemo } from 'react'
import type { PermissionType, WorkspacePermissions } from '@/hooks/use-workspace-permissions'

export interface WorkspaceUserPermissions {
  // Core permission checks
  canRead: boolean
  canEdit: boolean
  canAdmin: boolean

  // Utility properties
  userPermissions: PermissionType
  isLoading: boolean
  error: string | null
}

/**
 * Custom hook to check current user's permissions within a workspace
 * This version accepts workspace permissions to avoid duplicate API calls
 *
 * @param workspacePermissions - The workspace permissions data
 * @param permissionsLoading - Whether permissions are currently loading
 * @param permissionsError - Any error from fetching permissions
 * @returns Object containing permission flags and utility properties
 */
export function useUserPermissions(
  workspacePermissions: WorkspacePermissions | null,
  permissionsLoading = false,
  permissionsError: string | null = null
): WorkspaceUserPermissions {
  const userPermissions = useMemo((): WorkspaceUserPermissions => {
    if (permissionsLoading) {
      return {
        canRead: false,
        canEdit: false,
        canAdmin: false,
        userPermissions: 'read',
        isLoading: true,
        error: permissionsError,
      }
    }

    if (permissionsError) {
      return {
        canRead: false,
        canEdit: false,
        canAdmin: false,
        userPermissions: 'read',
        isLoading: false,
        error: permissionsError,
      }
    }

    const userPerms = workspacePermissions?.currentUserPermission
    if (!userPerms) {
      return {
        canRead: false,
        canEdit: false,
        canAdmin: false,
        userPermissions: 'read',
        isLoading: false,
        error: 'User not found in workspace',
      }
    }

    const canAdmin = userPerms === 'admin'
    const canEdit = userPerms === 'write' || userPerms === 'admin'

    return {
      canRead: true,
      canEdit,
      canAdmin,
      userPermissions: userPerms,
      isLoading: false,
      error: null,
    }
  }, [workspacePermissions?.currentUserPermission, permissionsLoading, permissionsError])

  return userPermissions
}
