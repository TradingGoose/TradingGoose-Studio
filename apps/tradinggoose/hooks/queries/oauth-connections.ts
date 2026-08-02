import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { OAUTH_PROVIDERS, type OAuthServiceConfig } from '@/lib/oauth/oauth'

/**
 * Query key factories for OAuth connections
 */
export const oauthConnectionsKeys = {
  all: ['oauthConnections'] as const,
  connections: () => [...oauthConnectionsKeys.all, 'connections'] as const,
}

/**
 * Service info type
 */
export interface ServiceInfo extends OAuthServiceConfig {
  isConnected: boolean
  lastConnected?: string
  accounts?: { id: string; name: string }[]
}

/**
 * Define available services from standardized OAuth providers
 */
function defineServices(): ServiceInfo[] {
  const servicesList: ServiceInfo[] = []

  Object.values(OAUTH_PROVIDERS).forEach((provider) => {
    Object.values(provider.services).forEach((service) => {
      servicesList.push({
        ...service,
        isConnected: false,
        scopes: service.scopes || [],
      })
    })
  })

  return servicesList
}

/**
 * Fetch OAuth connections and merge with service definitions
 */
async function fetchOAuthConnections(): Promise<ServiceInfo[]> {
  const serviceDefinitions = defineServices()

  const response = await fetch('/api/auth/oauth/connections')

  if (!response.ok) {
    throw new Error('Failed to fetch OAuth connections')
  }

  const data = await response.json()
  const connections = data.connections || []

  return serviceDefinitions.map((service) => {
    const connection = connections.find((conn: any) => conn.provider === service.providerId)

    if (connection) {
      return {
        ...service,
        isConnected: connection.accounts?.length > 0,
        accounts: connection.accounts || [],
        lastConnected: connection.lastConnected,
      }
    }

    return service
  })
}

/**
 * Hook to fetch OAuth connections
 */
export function useOAuthConnections({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: oauthConnectionsKeys.connections(),
    queryFn: fetchOAuthConnections,
    enabled,
    staleTime: 30 * 1000, // 30 seconds - connections don't change often
    retry: false,
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

export async function disconnectOAuthService({ accountId }: { accountId: string }) {
  const response = await fetch('/api/auth/oauth/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown
      code?: unknown
    } | null
    const error = new Error(
      typeof body?.error === 'string' ? body.error : 'Failed to disconnect service'
    ) as Error & { code?: string }
    if (typeof body?.code === 'string') error.code = body.code
    throw error
  }

  return response.json()
}
