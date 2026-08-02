import { useEffect } from 'react'
import { keepPreviousData, type QueryClient, useQuery } from '@tanstack/react-query'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { fetchPersonalEnvironment, fetchWorkspaceEnvironment } from '@/lib/environment/api'
import { usePathname } from '@/i18n/navigation'
import { useEnvironmentStore } from '@/stores/settings/environment/store'

export const environmentKeys = {
  all: ['environment'] as const,
  personal: () => [...environmentKeys.all, 'personal'] as const,
  workspace: (workspaceId: string) => [...environmentKeys.all, 'workspace', workspaceId] as const,
}

export type { WorkspaceEnvironmentData } from '@/lib/environment/api'

export async function refreshEnvironmentQueries(
  queryClient: QueryClient,
  scope: 'workspace' | 'personal',
  workspaceId: string
) {
  try {
    const queryKey: readonly unknown[] =
      scope === 'personal' ? environmentKeys.all : environmentKeys.workspace(workspaceId)
    await queryClient.invalidateQueries({ queryKey }, { throwOnError: true })
    return { ok: true } as const
  } catch (error) {
    return { ok: false, error } as const
  }
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
