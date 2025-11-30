import { config } from './config'
import { validateUnkeyKey } from '../services/unkey'

export interface AuthContext {
  userId?: string
  keyId?: string
  isServiceKey: boolean
  rateLimitKey: string
}

function normalizeKey(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim()
  }
  return trimmed
}

export async function authenticateRequest(apiKeyHeader: string | null): Promise<AuthContext | null> {
  const apiKey = normalizeKey(apiKeyHeader)
  if (!apiKey) return null

  // Shared service key (used by Next.js proxy)
  if (config.serviceApiKey && apiKey === config.serviceApiKey) {
    return {
      isServiceKey: true,
      rateLimitKey: 'service',
    }
  }

  // Unkey-backed keys (optional)
  const unkey = await validateUnkeyKey(apiKey)
  if (unkey.valid) {
    return {
      isServiceKey: false,
      userId: unkey.userId,
      keyId: unkey.keyId,
      rateLimitKey: unkey.userId || unkey.keyId || apiKey,
    }
  }

  // No other auth mechanisms enabled
  return null
}
