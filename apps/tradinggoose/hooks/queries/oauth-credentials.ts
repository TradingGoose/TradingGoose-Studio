import { useQuery } from '@tanstack/react-query'
import type { Credential } from '@/lib/oauth'

interface CredentialListResponse {
  credentials?: Credential[]
}

async function fetchJson<T>(
  url: string,
  options?: { searchParams?: Record<string, string | undefined> }
): Promise<T> {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(options?.searchParams ?? {})) {
    if (value !== undefined) {
      searchParams.set(key, value)
    }
  }
  const requestUrl = searchParams.size > 0 ? `${url}?${searchParams.toString()}` : url
  const response = await fetch(requestUrl, {
    method: 'GET',
  })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

export const oauthCredentialKeys = {
  list: (providerId?: string, workspaceId?: string, workflowId?: string) =>
    [
      'oauthCredentials',
      providerId ?? 'none',
      workspaceId ?? 'none',
      workflowId ?? 'none',
    ] as const,
  listByProviderIds: (providerIds: string[], workspaceId?: string, workflowId?: string) =>
    [
      'oauthCredentialsByProviderIds',
      providerIds,
      workspaceId ?? 'none',
      workflowId ?? 'none',
    ] as const,
}

export async function fetchOAuthCredentials(
  providerId: string,
  options?: { workspaceId?: string; workflowId?: string }
): Promise<Credential[]> {
  if (!providerId) return []
  const data = await fetchJson<CredentialListResponse>('/api/auth/oauth/credentials', {
    searchParams: {
      provider: providerId,
      workspaceId: options?.workspaceId,
      workflowId: options?.workflowId,
    },
  })
  return data.credentials ?? []
}

export function useOAuthCredentials(
  providerId?: string,
  enabled = true,
  options?: { workspaceId?: string; workflowId?: string }
) {
  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.list(providerId, options?.workspaceId, options?.workflowId),
    queryFn: () => fetchOAuthCredentials(providerId ?? '', options),
    enabled: Boolean(providerId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useOAuthCredentialsByProviderIds(
  providerIds: string[],
  enabled = true,
  options?: { workspaceId?: string; workflowId?: string }
) {
  const normalizedProviderIds = Array.from(
    new Set(providerIds.map((providerId) => providerId.trim()).filter(Boolean))
  )

  return useQuery<Record<string, Credential[]>>({
    queryKey: oauthCredentialKeys.listByProviderIds(
      normalizedProviderIds,
      options?.workspaceId,
      options?.workflowId
    ),
    queryFn: async () => {
      const entries = await Promise.all(
        normalizedProviderIds.map(
          async (providerId) =>
            [providerId, await fetchOAuthCredentials(providerId, options)] as const
        )
      )

      return Object.fromEntries(entries)
    },
    enabled: normalizedProviderIds.length > 0 && enabled,
    staleTime: 60 * 1000,
  })
}
