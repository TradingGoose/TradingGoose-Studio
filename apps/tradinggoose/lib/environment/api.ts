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

type EnvironmentTarget =
  | { scope: 'personal'; callbackPathname: string }
  | { scope: 'workspace'; workspaceId: string; callbackPathname: string }

export type SaveEnvironmentVariableParams = EnvironmentTarget & {
  originalKey: string | null
  key: string
  value: string
}

export type DeleteEnvironmentVariableParams = EnvironmentTarget & {
  key: string
}

async function throwEnvironmentResponseError(
  response: Response,
  reason: string,
  callbackPathname: string,
  message: string
): Promise<never> {
  if (response.status === 401) {
    await handleAuthError(reason, callbackPathname)
  }

  throw new Error(`${message}: ${response.statusText}`)
}

const getEnvironmentEndpoint = (target: EnvironmentTarget) =>
  target.scope === 'workspace'
    ? API_ENDPOINTS.WORKSPACE_ENVIRONMENT(target.workspaceId)
    : API_ENDPOINTS.ENVIRONMENT

export async function saveEnvironmentVariable(
  params: SaveEnvironmentVariableParams
): Promise<void> {
  const { scope, callbackPathname, originalKey, key, value } = params
  const response = await fetch(getEnvironmentEndpoint(params), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalKey, key, value }),
  })

  if (!response.ok) {
    await throwEnvironmentResponseError(
      response,
      `environment-api:save-${scope}`,
      callbackPathname,
      'Failed to save environment variable'
    )
  }
}

export async function deleteEnvironmentVariable(
  params: DeleteEnvironmentVariableParams
): Promise<void> {
  const { scope, callbackPathname, key } = params
  const response = await fetch(getEnvironmentEndpoint(params), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })

  if (!response.ok) {
    await throwEnvironmentResponseError(
      response,
      `environment-api:delete-${scope}`,
      callbackPathname,
      'Failed to delete environment variable'
    )
  }
}

export async function fetchPersonalEnvironment(
  callbackPathname: string
): Promise<Record<string, EnvironmentVariable>> {
  const response = await fetch(API_ENDPOINTS.ENVIRONMENT, { cache: 'no-store' })

  if (!response.ok) {
    if (response.status === 401) {
      await handleAuthError('environment-api:personal', callbackPathname)
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
  workspaceId: string,
  callbackPathname: string
): Promise<WorkspaceEnvironmentData> {
  const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
    cache: 'no-store',
  })

  if (!response.ok) {
    if (response.status === 401) {
      await handleAuthError('environment-api:workspace', callbackPathname)
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
