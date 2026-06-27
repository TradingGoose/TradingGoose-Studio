import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { db } from '@tradinggoose/db'
import { apiKey as apiKeyTable } from '@tradinggoose/db/schema'
import { and, eq, inArray, like, type SQL } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ApiKeyService')
const API_KEY_SECRET_PATTERN = /^[A-Za-z0-9_-]{32}$/
const API_KEY_PREFIX = 'sk-tradinggoose-'
const STORED_API_KEY_SEPARATOR = ':'
const DEFAULT_API_KEY_AUTH_TYPES: ApiKeyType[] = ['personal', 'workspace']
// Canonical stored shape: display:lookupDigest:iv:ciphertext:authTag.
// Retired plaintext/encrypted rows are intentionally not authenticated.

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
  storedKey?: string
}> {
  try {
    const plainKey = generateApiKey()

    if (useStorage) {
      return { key: plainKey, storedKey: getStoredApiKey(plainKey) }
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
    const conditions: SQL[] = [like(apiKeyTable.key, `${getStoredApiKeyLookupPrefix(apiKey)}%`)]

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

    const [storedKey] = await query.where(and(...conditions)).limit(1)
    if (!storedKey || (storedKey.expiresAt && storedKey.expiresAt < new Date())) {
      return { success: false, error: 'Invalid API key' }
    }

    if (!(await storedApiKeyMatches(apiKey, storedKey.key))) {
      return { success: false, error: 'Invalid API key' }
    }

    return {
      success: true,
      userId: storedKey.userId,
      keyId: storedKey.id,
      keyType: storedKey.type as ApiKeyType,
      workspaceId: storedKey.workspaceId || undefined,
    }
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

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${nanoid(32)}`
}

export function isApiKeyFormat(apiKey: string): boolean {
  if (isCurrentApiKeyFormat(apiKey)) {
    return API_KEY_SECRET_PATTERN.test(apiKey.slice(API_KEY_PREFIX.length))
  }
  return false
}

export function isCurrentApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith(API_KEY_PREFIX)
}

export function formatApiKeyForDisplay(apiKey: string): string {
  const last4 = apiKey.slice(-4)
  if (isCurrentApiKeyFormat(apiKey)) {
    return `${API_KEY_PREFIX}...${last4}`
  }
  return `...${last4}`
}

function getApiKeyLookupDigest(apiKey: string): string {
  return createHmac('sha256', getApiEncryptionKey()).update(apiKey).digest('hex')
}

function getApiEncryptionKey(): Buffer {
  const key = env.API_ENCRYPTION_KEY
  if (!key) {
    throw new Error('API_ENCRYPTION_KEY is required for API key storage')
  }
  if (!/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error('API_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

export function isApiKeyStorageAvailable(): boolean {
  return Boolean(env.API_ENCRYPTION_KEY)
}

function encryptApiKeyForStorage(apiKey: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getApiEncryptionKey(), iv)
  let encrypted = cipher.update(apiKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return [
    formatApiKeyForDisplay(apiKey),
    getApiKeyLookupDigest(apiKey),
    iv.toString('hex'),
    encrypted,
    cipher.getAuthTag().toString('hex'),
  ].join(STORED_API_KEY_SEPARATOR)
}

function decryptStoredApiKey(storedApiKey: string): string {
  const [, , ivHex, encrypted, authTagHex] = storedApiKey.split(STORED_API_KEY_SEPARATOR)
  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid stored API key format')
  }

  const decipher = createDecipheriv('aes-256-gcm', getApiEncryptionKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function getStoredApiKeyLookupPrefix(apiKey: string): string {
  return [formatApiKeyForDisplay(apiKey), getApiKeyLookupDigest(apiKey), ''].join(
    STORED_API_KEY_SEPARATOR
  )
}

export function getStoredApiKey(apiKey: string): string {
  return encryptApiKeyForStorage(apiKey)
}

function isStoredApiKeyFormat(storedApiKey: string): boolean {
  const [displayKey, lookupDigest, iv, encrypted, authTag, extra] =
    storedApiKey.split(STORED_API_KEY_SEPARATOR)
  return Boolean(displayKey && lookupDigest?.length === 64 && iv && encrypted && authTag && !extra)
}

function constantTimeEqual(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

export async function storedApiKeyMatches(apiKey: string, storedApiKey: string): Promise<boolean> {
  if (!isApiKeyFormat(apiKey) || !isStoredApiKeyFormat(storedApiKey)) {
    return false
  }
  const [, lookupDigest] = storedApiKey.split(STORED_API_KEY_SEPARATOR)
  if (!lookupDigest || !constantTimeEqual(getApiKeyLookupDigest(apiKey), lookupDigest)) {
    return false
  }
  try {
    return constantTimeEqual(apiKey, decryptStoredApiKey(storedApiKey))
  } catch (error) {
    logger.error('Failed to decrypt stored API key:', { error })
    return false
  }
}

export async function getApiKeyDisplayFormat(storedApiKey: string): Promise<string> {
  if (!isStoredApiKeyFormat(storedApiKey)) {
    return '****'
  }
  return storedApiKey.split(STORED_API_KEY_SEPARATOR)[0]
}
