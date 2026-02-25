import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { API_ENDPOINTS } from '@/stores/constants'
import type { EnvironmentVariable } from '@/stores/settings/environment/types'

export interface WorkspaceEnvironmentRow {
  key: string
  value: string
  createdAt?: string | null
  updatedAt?: string | null
}

export interface WorkspaceEnvironmentData {
  workspace: Record<string, string>
  personal: Record<string, string>
  conflicts: string[]
  workspaceRows: WorkspaceEnvironmentRow[]
  personalRows: WorkspaceEnvironmentRow[]
}

export async function fetchPersonalEnvironment(): Promise<Record<string, EnvironmentVariable>> {
  const response = await fetch(API_ENDPOINTS.ENVIRONMENT, { cache: 'no-store' })

  if (!response.ok) {
    if (response.status === 401) {
      await handleAuthError('environment-api:personal')
    }
    throw new Error(`Failed to load environment variables: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (data && typeof data === 'object') {
    return data
  }

  return {}
}

export async function fetchWorkspaceEnvironment(
  workspaceId: string
): Promise<WorkspaceEnvironmentData> {
  const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
    cache: 'no-store',
  })

  if (!response.ok) {
    if (response.status === 401) {
      await handleAuthError('environment-api:workspace')
    }
    throw new Error(`Failed to load workspace environment: ${response.statusText}`)
  }

  const { data } = await response.json()

  return {
    workspace: data?.workspace || {},
    personal: data?.personal || {},
    conflicts: data?.conflicts || [],
    workspaceRows: data?.workspaceRows || [],
    personalRows: data?.personalRows || [],
  }
}
