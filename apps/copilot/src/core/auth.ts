import { config } from './config'
import { lookupApiKey } from '../../db/key-store'

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
  if (config.internalApiSecret && apiKey === config.internalApiSecret) {
    return {
      isServiceKey: true,
      rateLimitKey: 'service',
    }
  }

  // Local copilot-issued keys
  const localKey = await lookupApiKey(apiKey)
  if (localKey) {
    return {
      isServiceKey: false,
      userId: localKey.userId,
      keyId: localKey.keyId,
      rateLimitKey: localKey.userId || localKey.keyId || apiKey,
    }
  }

  // No other auth mechanisms enabled
  return null
}
