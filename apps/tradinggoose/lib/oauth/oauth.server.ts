import { createLogger } from '@/lib/logs/console/logger'
import {
  getBaseProviderForService,
  isSystemIntegrationManagedOAuthServiceProviderId,
  isSignInOAuthProviderId,
  type OAuthProviderAvailability,
} from '@/lib/oauth/oauth'
import {
  loadSystemOAuthClientCredentials,
  loadSystemOAuthClientCredentialsForProvider,
} from '@/lib/oauth/system-managed-config'
import { getEnv } from '@/lib/env'

const logger = createLogger('OAuth')

interface ProviderAuthConfig {
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  useBasicAuth: boolean
  requiresClientSecret?: boolean
  additionalHeaders?: Record<string, string>
  supportsRefreshTokenRotation?: boolean
  useJsonBody?: boolean
}

interface ProviderAuthCredentials {
  clientId: string
  clientSecret: string
}

function getSignInProviderEnvironmentCredentials(providerId: string): ProviderAuthCredentials | null {
  switch (providerId.trim()) {
    case 'github':
      return pickCredentials(getEnv('GITHUB_CLIENT_ID'), getEnv('GITHUB_CLIENT_SECRET'))
    case 'google':
      return pickCredentials(getEnv('GOOGLE_CLIENT_ID'), getEnv('GOOGLE_CLIENT_SECRET'))
    default:
      return null
  }
}

function getProviderAuthTemplate(providerId: string): Omit<ProviderAuthConfig, 'clientId' | 'clientSecret'> {
  switch (providerId) {
    case 'google':
      return {
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        useBasicAuth: false,
      }
    case 'github':
      return {
        tokenEndpoint: 'https://github.com/login/oauth/access_token',
        useBasicAuth: false,
        additionalHeaders: { Accept: 'application/json' },
      }
    case 'x':
      return {
        tokenEndpoint: 'https://api.x.com/2/oauth2/token',
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    case 'confluence':
    case 'jira':
      return {
        tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    case 'airtable':
      return {
        tokenEndpoint: 'https://airtable.com/oauth2/v1/token',
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    case 'supabase':
      return {
        tokenEndpoint: 'https://api.supabase.com/v1/oauth/token',
        useBasicAuth: false,
      }
    case 'notion':
      return {
        tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
        useJsonBody: true,
      }
    case 'discord':
      return {
        tokenEndpoint: 'https://discord.com/api/v10/oauth2/token',
        useBasicAuth: true,
      }
    case 'microsoft':
      return {
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        useBasicAuth: false,
      }
    case 'linear':
      return {
        tokenEndpoint: 'https://api.linear.app/oauth/token',
        useBasicAuth: true,
        supportsRefreshTokenRotation: true,
      }
    case 'slack':
      return {
        tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    case 'reddit':
      return {
        tokenEndpoint: 'https://www.reddit.com/api/v1/access_token',
        useBasicAuth: true,
        additionalHeaders: {
          'User-Agent': 'tradinggoose-studio/1.0',
        },
      }
    case 'tradier':
      return {
        tokenEndpoint: 'https://api.tradier.com/v1/oauth/token',
        useBasicAuth: false,
      }
    case 'wealthbox':
      return {
        tokenEndpoint: 'https://app.crmworkspace.com/oauth/token',
        useBasicAuth: false,
        supportsRefreshTokenRotation: true,
      }
    case 'webflow':
      return {
        tokenEndpoint: 'https://api.webflow.com/oauth/access_token',
        useBasicAuth: false,
        supportsRefreshTokenRotation: false,
      }
    case 'alpaca':
      return {
        tokenEndpoint: 'https://api.alpaca.markets/oauth/token',
        useBasicAuth: false,
      }
    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}

function pickCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined,
  requiresClientSecret = true
): ProviderAuthCredentials | null {
  const normalizedClientId = clientId?.trim() ?? ''
  const normalizedClientSecret = clientSecret?.trim() ?? ''

  if (!normalizedClientId || (requiresClientSecret && !normalizedClientSecret)) {
    return null
  }

  return {
    clientId: normalizedClientId,
    clientSecret: normalizedClientSecret,
  }
}

async function getProviderAuthCredentials(
  providerId: string
): Promise<ProviderAuthCredentials | null> {
  const normalizedProviderId = providerId.trim()
  if (!isSystemIntegrationManagedOAuthServiceProviderId(normalizedProviderId)) {
    return null
  }

  const authTemplate = getProviderAuthTemplate(getBaseProviderForService(normalizedProviderId))
  const credentials = await loadSystemOAuthClientCredentialsForProvider(normalizedProviderId)
  return pickCredentials(
    credentials?.clientId,
    credentials?.clientSecret,
    authTemplate.requiresClientSecret !== false
  )
}

async function getProviderAuthConfig(providerId: string): Promise<ProviderAuthConfig> {
  const credentials = await getProviderAuthCredentials(providerId)

  if (!credentials) {
    throw new Error(`Missing client credentials for provider: ${providerId}`)
  }

  return {
    ...getProviderAuthTemplate(getBaseProviderForService(providerId)),
    ...credentials,
  }
}

function buildAuthRequest(
  config: ProviderAuthConfig,
  refreshToken: string
): { headers: Record<string, string>; bodyParams: Record<string, string>; useJsonBody: boolean } {
  const headers: Record<string, string> = {
    'Content-Type': config.useJsonBody ? 'application/json' : 'application/x-www-form-urlencoded',
    ...config.additionalHeaders,
  }

  const bodyParams: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }

  if (config.useBasicAuth) {
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${basicAuth}`
  } else {
    bodyParams.client_id = config.clientId
    if (config.clientSecret.trim()) {
      bodyParams.client_secret = config.clientSecret
    }
  }

  return { headers, bodyParams, useJsonBody: Boolean(config.useJsonBody) }
}

export const getOAuthProviderAvailability = async (
  providers: string[] = []
): Promise<OAuthProviderAvailability> => {
  const availability: OAuthProviderAvailability = {}
  const uniqueProviders = Array.from(
    new Set(providers.map((provider) => provider.trim()).filter((provider) => provider.length > 0))
  )
  const systemManagedProviders = uniqueProviders.filter((providerId) => !isSignInOAuthProviderId(providerId))
  const credentials = await loadSystemOAuthClientCredentials(systemManagedProviders)

  for (const providerId of uniqueProviders) {
    if (isSignInOAuthProviderId(providerId)) {
      availability[providerId] = Boolean(getSignInProviderEnvironmentCredentials(providerId))
      continue
    }

    availability[providerId] = Boolean(credentials[providerId])
  }

  return availability
}

export async function refreshOAuthToken(
  providerId: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; refreshToken: string } | null> {
  try {
    const config = await getProviderAuthConfig(providerId)
    const provider = getBaseProviderForService(providerId)
    const { headers, bodyParams, useJsonBody } = buildAuthRequest(config, refreshToken)

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers,
      body: useJsonBody ? JSON.stringify(bodyParams) : new URLSearchParams(bodyParams).toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorData = errorText
      try {
        errorData = JSON.parse(errorText)
      } catch (_error) {
        // Keep raw error text when it is not JSON.
      }

      logger.error('Token refresh failed:', {
        status: response.status,
        error: errorText,
        parsedError: errorData,
        providerId,
      })
      throw new Error(`Failed to refresh token: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    const accessToken = data.access_token
    let newRefreshToken = null

    if (config.supportsRefreshTokenRotation && data.refresh_token) {
      newRefreshToken = data.refresh_token
      logger.info(`Received new refresh token from ${provider}`)
    }

    const expiresIn = data.expires_in || data.expiresIn || 3600

    if (!accessToken) {
      logger.warn('No access token found in refresh response', data)
      return null
    }

    logger.info('Token refreshed successfully with expiration', {
      expiresIn,
      hasNewRefreshToken: !!newRefreshToken,
      provider,
    })

    return {
      accessToken,
      expiresIn,
      refreshToken: newRefreshToken || refreshToken,
    }
  } catch (error) {
    logger.error(`Error refreshing token for provider ${providerId}:`, error)
    return null
  }
}
