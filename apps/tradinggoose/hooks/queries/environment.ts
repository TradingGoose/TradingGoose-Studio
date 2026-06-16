import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { fetchPersonalEnvironment, fetchWorkspaceEnvironment } from '@/lib/environment/api'
import { createLogger } from '@/lib/logs/console/logger'
import { usePathname } from '@/i18n/navigation'
import { API_ENDPOINTS } from '@/stores/constants'
import { useEnvironmentStore } from '@/stores/settings/environment/store'

const logger = createLogger('EnvironmentQueries')

export const environmentKeys = {
  all: ['environment'] as const,
  personal: () => [...environmentKeys.all, 'personal'] as const,
  workspace: (workspaceId: string) => [...environmentKeys.all, 'workspace', workspaceId] as const,
}

export type { WorkspaceEnvironmentData } from '@/lib/environment/api'

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

export function usePersonalEnvironment() {
  const pathname = usePathname()
  const setVariables = useEnvironmentStore((state) => state.setVariables)

  const query = useQuery({
    queryKey: environmentKeys.personal(),
    queryFn: () => fetchPersonalEnvironment(pathname),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (query.data) {
      setVariables(query.data)
    }
  }, [query.data, setVariables])

  return query
}

export function useWorkspaceEnvironment<TData = WorkspaceEnvironmentData>(
  workspaceId: string,
  options?: { select?: (data: WorkspaceEnvironmentData) => TData }
) {
  const pathname = usePathname()

  return useQuery({
    queryKey: environmentKeys.workspace(workspaceId),
    queryFn: () => fetchWorkspaceEnvironment(workspaceId, pathname),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    ...options,
  })
}

interface UpsertPersonalEnvironmentParams {
  key: string
  value: string
}

export function useUpsertPersonalEnvironment() {
  const queryClient = useQueryClient()
  const pathname = usePathname()

  return useMutation({
    mutationFn: async ({ key, value }: UpsertPersonalEnvironmentParams) => {
      const response = await fetch(API_ENDPOINTS.ENVIRONMENT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })

      if (!response.ok) {
        await throwEnvironmentResponseError(
          response,
          'environment-query:upsert-personal',
          pathname,
          'Failed to update personal environment variable'
        )
      }

      logger.info(`Upserted personal environment variable: ${key}`)
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
      queryClient.invalidateQueries({ queryKey: environmentKeys.all })
    },
  })
}

interface RemovePersonalEnvironmentParams {
  key: string
}

export function useRemovePersonalEnvironment() {
  const queryClient = useQueryClient()
  const pathname = usePathname()

  return useMutation({
    mutationFn: async ({ key }: RemovePersonalEnvironmentParams) => {
      const response = await fetch(API_ENDPOINTS.ENVIRONMENT, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })

      if (!response.ok) {
        await throwEnvironmentResponseError(
          response,
          'environment-query:remove-personal',
          pathname,
          'Failed to remove personal environment variable'
        )
      }

      logger.info(`Removed personal environment variable: ${key}`)
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
      queryClient.invalidateQueries({ queryKey: environmentKeys.all })
    },
  })
}

interface UpsertWorkspaceEnvironmentParams {
  workspaceId: string
  variables: Record<string, string>
}

export function useUpsertWorkspaceEnvironment() {
  const queryClient = useQueryClient()
  const pathname = usePathname()

  return useMutation({
    mutationFn: async ({ workspaceId, variables }: UpsertWorkspaceEnvironmentParams) => {
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables }),
      })

      if (!response.ok) {
        await throwEnvironmentResponseError(
          response,
          'environment-query:upsert-workspace',
          pathname,
          'Failed to update workspace environment'
        )
      }

      logger.info(`Upserted workspace environment variables for workspace: ${workspaceId}`)
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
    },
  })
}

interface RemoveWorkspaceEnvironmentParams {
  workspaceId: string
  keys: string[]
}

export function useRemoveWorkspaceEnvironment() {
  const queryClient = useQueryClient()
  const pathname = usePathname()

  return useMutation({
    mutationFn: async ({ workspaceId, keys }: RemoveWorkspaceEnvironmentParams) => {
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })

      if (!response.ok) {
        await throwEnvironmentResponseError(
          response,
          'environment-query:remove-workspace',
          pathname,
          'Failed to remove workspace environment keys'
        )
      }

      logger.info(`Removed ${keys.length} workspace environment keys for workspace: ${workspaceId}`)
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: environmentKeys.workspace(variables.workspaceId),
      })
      queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
    },
  })
}
