import { useQuery } from '@tanstack/react-query'

export const apiKeysKeys = {
  all: ['apiKeys'] as const,
  personal: () => [...apiKeysKeys.all, 'personal'] as const,
  workspace: (workspaceId: string) => [...apiKeysKeys.all, 'workspace', workspaceId] as const,
}

export interface ApiKey {
  id: string
  name: string
  key?: string
  displayKey?: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
  createdBy?: string
}

async function fetchApiKeys(url: string): Promise<ApiKey[]> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Failed to load API keys')
  }
  const data = await response.json()
  return data.keys || []
}

export function useWorkspaceApiKeys(workspaceId: string) {
  return useQuery({
    queryKey: apiKeysKeys.workspace(workspaceId),
    queryFn: () => fetchApiKeys(`/api/workspaces/${workspaceId}/api-keys`),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })
}

export function usePersonalApiKeys() {
  return useQuery({
    queryKey: apiKeysKeys.personal(),
    queryFn: () => fetchApiKeys('/api/users/me/api-keys'),
    staleTime: 60 * 1000,
  })
}

export interface CreateApiKeyParams {
  workspaceId: string
  name: string
  keyType: 'personal' | 'workspace'
}

export async function createApiKey({ workspaceId, name, keyType }: CreateApiKeyParams) {
  const response = await fetch(
    keyType === 'workspace' ? `/api/workspaces/${workspaceId}/api-keys` : '/api/users/me/api-keys',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    }
  )

  if (!response.ok) {
    throw new Error('Failed to create API key')
  }

  return response.json() as Promise<{ key: ApiKey }>
}

export interface RenameApiKeyParams {
  workspaceId: string
  keyId: string
  name: string
}

export async function renameWorkspaceApiKey({ workspaceId, keyId, name }: RenameApiKeyParams) {
  const response = await fetch(`/api/workspaces/${workspaceId}/api-keys/${keyId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  })

  if (!response.ok) {
    throw new Error('Failed to rename API key')
  }

  return response.json()
}

export interface DeleteApiKeyParams {
  workspaceId: string
  keyId: string
  keyType: 'personal' | 'workspace'
}

export async function deleteApiKey({ workspaceId, keyId, keyType }: DeleteApiKeyParams) {
  const response = await fetch(
    keyType === 'workspace'
      ? `/api/workspaces/${workspaceId}/api-keys/${keyId}`
      : `/api/users/me/api-keys/${keyId}`,
    { method: 'DELETE' }
  )

  if (!response.ok) {
    throw new Error('Failed to delete API key')
  }

  return response.json()
}
