import { useQuery } from '@tanstack/react-query'
import type { Credential } from '@/lib/oauth'

interface CredentialListResponse {
  credentials?: Credential[]
}

interface CredentialDetailResponse {
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
  list: (providerId?: string) => ['oauthCredentials', providerId ?? 'none'] as const,
  detail: (credentialId?: string, workflowId?: string) =>
    ['oauthCredentialDetail', credentialId ?? 'none', workflowId ?? 'none'] as const,
}

export async function fetchOAuthCredentials(providerId: string): Promise<Credential[]> {
  if (!providerId) return []
  const data = await fetchJson<CredentialListResponse>('/api/auth/oauth/credentials', {
    searchParams: { provider: providerId },
  })
  return data.credentials ?? []
}

export async function fetchOAuthCredentialDetail(
  credentialId: string,
  workflowId?: string
): Promise<Credential[]> {
  if (!credentialId) return []
  const data = await fetchJson<CredentialDetailResponse>('/api/auth/oauth/credentials', {
    searchParams: {
      credentialId,
      workflowId,
    },
  })
  return data.credentials ?? []
}

export function useOAuthCredentials(providerId?: string, enabled = true) {
  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.list(providerId),
    queryFn: () => fetchOAuthCredentials(providerId ?? ''),
    enabled: Boolean(providerId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useOAuthCredentialDetail(
  credentialId?: string,
  workflowId?: string,
  enabled = true
) {
  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.detail(credentialId, workflowId),
    queryFn: () => fetchOAuthCredentialDetail(credentialId ?? '', workflowId),
    enabled: Boolean(credentialId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useCredentialName(credentialId?: string, providerId?: string, workflowId?: string) {
  const { data: credentials = [], isFetching: credentialsLoading } = useOAuthCredentials(
    providerId,
    Boolean(providerId)
  )

  const selectedCredential = credentials.find((cred) => cred.id === credentialId)

  const shouldFetchDetail = Boolean(credentialId && !selectedCredential && providerId && workflowId)

  const { data: foreignCredentials = [], isFetching: foreignLoading } = useOAuthCredentialDetail(
    shouldFetchDetail ? credentialId : undefined,
    workflowId,
    shouldFetchDetail
  )

  const hasForeignMeta = foreignCredentials.length > 0

  const displayName = selectedCredential?.name ?? (hasForeignMeta ? 'Saved by collaborator' : null)

  return {
    displayName,
    isLoading: credentialsLoading || foreignLoading,
    hasForeignMeta,
  }
}
