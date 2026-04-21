import { createWithEqualityFn as create } from 'zustand/traditional'
import { handleAuthError } from '@/lib/auth/auth-error-handler'
import { fetchPersonalEnvironment, fetchWorkspaceEnvironment } from '@/lib/environment/api'
import { createLogger } from '@/lib/logs/console/logger'
import { API_ENDPOINTS } from '@/stores/constants'
import type { EnvironmentStore, EnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentStore')

export const useEnvironmentStore = create<EnvironmentStore>()((set, get) => ({
  variables: {},
  isLoading: false,
  error: null,

  loadEnvironmentVariables: async () => {
    try {
      set({ isLoading: true, error: null })

      const data = await fetchPersonalEnvironment()

      set({
        variables: data,
        isLoading: false,
      })
    } catch (error) {
      logger.error('Error loading environment variables:', { error })
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  setVariables: (variables: Record<string, EnvironmentVariable>) => {
    set({ variables })
  },

  saveEnvironmentVariables: async (variables: Record<string, string>) => {
    try {
      set({ isLoading: true, error: null })

      const transformedVariables = Object.fromEntries(
        Object.entries(variables).map(([key, value]) => [key, { key, value }])
      )

      set({ variables: transformedVariables })

      const response = await fetch(API_ENDPOINTS.ENVIRONMENT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ variables }),
      })

      if (!response.ok) {
        if (response.status === 401) {
          await handleAuthError('environment-store:save')
        }
        throw new Error(`Failed to save environment variables: ${response.statusText}`)
      }

      set({ isLoading: false })
    } catch (error) {
      logger.error('Error saving environment variables:', { error })
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      })

      get().loadEnvironmentVariables()
    }
  },

  loadWorkspaceEnvironment: async (workspaceId: string) => {
    try {
      set({ isLoading: true, error: null })

      const data = await fetchWorkspaceEnvironment(workspaceId)
      set({ isLoading: false })
      return data as {
        workspace: Record<string, string>
        personal: Record<string, string>
        conflicts: string[]
        workspaceRows?: Array<{
          key: string
          value: string
          createdAt?: string | null
          updatedAt?: string | null
        }>
        personalRows?: Array<{
          key: string
          value: string
          createdAt?: string | null
          updatedAt?: string | null
        }>
      }
    } catch (error) {
      logger.error('Error loading workspace environment:', { error })
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })
      return { workspace: {}, personal: {}, conflicts: [] }
    }
  },

  upsertWorkspaceEnvironment: async (workspaceId: string, variables: Record<string, string>) => {
    try {
      set({ isLoading: true, error: null })
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables }),
      })
      if (!response.ok) {
        if (response.status === 401) {
          await handleAuthError('environment-store:upsert-workspace')
        }
        throw new Error(`Failed to update workspace environment: ${response.statusText}`)
      }
      set({ isLoading: false })
    } catch (error) {
      logger.error('Error updating workspace environment:', { error })
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })
    }
  },

  removeWorkspaceEnvironmentKeys: async (workspaceId: string, keys: string[]) => {
    try {
      set({ isLoading: true, error: null })
      const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })
      if (!response.ok) {
        if (response.status === 401) {
          await handleAuthError('environment-store:remove-keys')
        }
        throw new Error(`Failed to remove workspace environment keys: ${response.statusText}`)
      }
      set({ isLoading: false })
    } catch (error) {
      logger.error('Error removing workspace environment keys:', { error })
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false })
    }
  },

  getAllVariables: (): Record<string, EnvironmentVariable> => {
    return get().variables
  },
}))
