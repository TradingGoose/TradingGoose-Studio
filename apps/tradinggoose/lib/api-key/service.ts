import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { db } from '@tradinggoose/db'
import { apiKey as apiKeyTable } from '@tradinggoose/db/schema'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ApiKeyService')
const API_KEY_SECRET_PATTERN = /^[A-Za-z0-9_-]{32}$/
const DEFAULT_API_KEY_AUTH_TYPES: ApiKeyType[] = ['personal', 'workspace']

export type ApiKeyType = 'personal' | 'workspace'

export interface ApiKeyAuthOptions {
  userId?: string
  workspaceId?: string
  keyTypes?: ApiKeyType[]
}

export interface ApiKeyAuthResult {
  success: boolean
  userId?: string
  keyId?: string
  keyType?: ApiKeyType
  workspaceId?: string
  error?: string
}

export async function createApiKey(useStorage = true): Promise<{
  key: string
  encryptedKey?: string
}> {
  try {
    const plainKey =
      env.API_ENCRYPTION_KEY !== undefined ? generateEncryptedApiKey() : generateApiKey()

    if (useStorage) {
      const encryptedKey = await encryptApiKeyForStorage(plainKey)
      return { key: plainKey, encryptedKey }
    }

    return { key: plainKey }
  } catch (error) {
    logger.error('API key creation error:', { error })
    throw new Error('Failed to create API key')
  }
}

/**
 * Authenticate an API key from header with flexible filtering options
 */
export async function authenticateApiKeyFromHeader(
  apiKeyHeader: string,
  options: ApiKeyAuthOptions = {}
): Promise<ApiKeyAuthResult> {
  const apiKey = apiKeyHeader.trim()
  if (!apiKey) {
    return { success: false, error: 'API key required' }
  }
  if (!isApiKeyFormat(apiKey)) {
    return { success: false, error: 'Invalid API key' }
  }

  try {
    const conditions: SQL[] = []

    if (options.userId) {
      conditions.push(eq(apiKeyTable.userId, options.userId))
    }

    if (options.workspaceId) {
      conditions.push(eq(apiKeyTable.workspaceId, options.workspaceId))
    }

    const keyTypes = options.keyTypes?.length ? options.keyTypes : DEFAULT_API_KEY_AUTH_TYPES
    if (keyTypes.length === 1) {
      conditions.push(eq(apiKeyTable.type, keyTypes[0]))
    } else {
      conditions.push(inArray(apiKeyTable.type, keyTypes))
    }

    const query = db
      .select({
        id: apiKeyTable.id,
        userId: apiKeyTable.userId,
        workspaceId: apiKeyTable.workspaceId,
        type: apiKeyTable.type,
        key: apiKeyTable.key,
        expiresAt: apiKeyTable.expiresAt,
      })
      .from(apiKeyTable)

    const keyRecords = conditions.length ? await query.where(and(...conditions)) : await query

    for (const storedKey of keyRecords) {
      if (storedKey.expiresAt && storedKey.expiresAt < new Date()) {
        continue
      }

      const isValid = await authenticateApiKey(apiKey, storedKey.key)
      if (!isValid) {
        continue
      }

      return {
        success: true,
        userId: storedKey.userId,
        keyId: storedKey.id,
        keyType: storedKey.type as ApiKeyType,
        workspaceId: storedKey.workspaceId || undefined,
      }
    }

    return { success: false, error: 'Invalid API key' }
  } catch (error) {
    logger.error('API key authentication error:', error)
    return { success: false, error: 'Authentication failed' }
  }
}

/**
 * Update the last used timestamp for an API key
 */
export async function updateApiKeyLastUsed(keyId: string): Promise<void> {
  try {
    await db.update(apiKeyTable).set({ lastUsed: new Date() }).where(eq(apiKeyTable.id, keyId))
  } catch (error) {
    logger.error('Error updating API key last used:', error)
  }
}

/**
 * Given a pinned API key ID, resolve the owning userId (actor).
 * Returns null if not found.
 */
export async function getApiKeyOwnerUserId(
  pinnedApiKeyId: string | null | undefined
): Promise<string | null> {
  if (!pinnedApiKeyId) return null
  try {
    const rows = await db
      .select({ userId: apiKeyTable.userId })
      .from(apiKeyTable)
      .where(eq(apiKeyTable.id, pinnedApiKeyId))
      .limit(1)
    return rows[0]?.userId ?? null
  } catch (error) {
    logger.error('Error resolving API key owner', { error, pinnedApiKeyId })
    return null
  }
}

function getApiEncryptionKey(): Buffer | null {
  const key = env.API_ENCRYPTION_KEY
  if (!key) {
    logger.warn(
      'API_ENCRYPTION_KEY not set - API keys will be stored in plain text. Consider setting this for better security.'
    )
    return null
  }
  if (key.length !== 64) {
    throw new Error('API_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

export async function encryptApiKey(apiKey: string): Promise<{ encrypted: string; iv: string }> {
  const key = getApiEncryptionKey()
  if (!key) {
    return { encrypted: apiKey, iv: '' }
  }

  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(apiKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()
  return {
    encrypted: `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`,
    iv: iv.toString('hex'),
  }
}

export async function decryptApiKey(encryptedValue: string): Promise<{ decrypted: string }> {
  if (!isEncryptedKey(encryptedValue)) {
    return { decrypted: encryptedValue }
  }

  const key = getApiEncryptionKey()
  if (!key) {
    return { decrypted: encryptedValue }
  }

  const [ivHex, encrypted, authTagHex] = encryptedValue.split(':')
  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid encrypted API key format. Expected "iv:encrypted:authTag"')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return { decrypted }
  } catch (error: unknown) {
    logger.error('API key decryption error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
  }
}

export function isEncryptedKey(storedKey: string): boolean {
  return storedKey.includes(':') && storedKey.split(':').length === 3
}

export async function authenticateApiKey(inputKey: string, storedKey: string): Promise<boolean> {
  try {
    if (isEncryptedApiKeyFormat(inputKey)) {
      if (!isEncryptedKey(storedKey)) {
        return false
      }
      try {
        const { decrypted } = await decryptApiKey(storedKey)
        return inputKey === decrypted
      } catch (decryptError) {
        logger.error('Failed to decrypt stored API key:', { error: decryptError })
        return false
      }
    }

    if (isPlainApiKeyFormat(inputKey)) {
      if (isEncryptedKey(storedKey)) {
        try {
          const { decrypted } = await decryptApiKey(storedKey)
          return inputKey === decrypted
        } catch (decryptError) {
          logger.error('Failed to decrypt stored API key:', { error: decryptError })
        }
      }
      return inputKey === storedKey
    }

    if (isEncryptedKey(storedKey)) {
      try {
        const { decrypted } = await decryptApiKey(storedKey)
        return inputKey === decrypted
      } catch (decryptError) {
        logger.error('Failed to decrypt stored API key:', { error: decryptError })
      }
    }

    return inputKey === storedKey
  } catch (error) {
    logger.error('API key authentication error:', { error })
    return false
  }
}

export async function encryptApiKeyForStorage(apiKey: string): Promise<string> {
  try {
    const { encrypted } = await encryptApiKey(apiKey)
    return encrypted
  } catch (error) {
    logger.error('API key encryption error:', { error })
    throw new Error('Failed to encrypt API key')
  }
}

export function generateApiKey(): string {
  return `tradinggoose_${nanoid(32)}`
}

export function generateEncryptedApiKey(): string {
  return `sk-tradinggoose-${nanoid(32)}`
}

export function isApiKeyFormat(apiKey: string): boolean {
  if (isEncryptedApiKeyFormat(apiKey)) {
    return API_KEY_SECRET_PATTERN.test(apiKey.slice('sk-tradinggoose-'.length))
  }
  if (isPlainApiKeyFormat(apiKey)) {
    return API_KEY_SECRET_PATTERN.test(apiKey.slice('tradinggoose_'.length))
  }
  return false
}

export function isEncryptedApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith('sk-tradinggoose-')
}

export function isPlainApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith('tradinggoose_') && !apiKey.startsWith('sk-tradinggoose-')
}

export function formatApiKeyForDisplay(apiKey: string): string {
  const last4 = apiKey.slice(-4)
  if (isEncryptedApiKeyFormat(apiKey)) {
    return `sk-tradinggoose-...${last4}`
  }
  if (isPlainApiKeyFormat(apiKey)) {
    return `tradinggoose_...${last4}`
  }
  return `...${last4}`
}

export async function storedApiKeyMatches(apiKey: string, storedApiKey: string): Promise<boolean> {
  return authenticateApiKey(apiKey, storedApiKey)
}

export async function getApiKeyDisplayFormat(storedApiKey: string): Promise<string> {
  try {
    const { decrypted } = await decryptApiKey(storedApiKey)
    return formatApiKeyForDisplay(decrypted)
  } catch (error) {
    logger.error('Failed to format API key for display:', { error })
    return '****'
  }
}
