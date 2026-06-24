import { createHash } from 'crypto'
import { db } from '@tradinggoose/db'
import { apiKey as apiKeyTable } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ApiKeyService')
const API_KEY_PATTERN = /^sk-tradinggoose-[A-Za-z0-9_-]{32}$/
const API_KEY_STORAGE_SEPARATOR = ':sha256:'

export interface ApiKeyAuthOptions {
  userId?: string
  workspaceId?: string
  keyTypes?: ('personal' | 'workspace')[]
}

export interface ApiKeyAuthResult {
  success: boolean
  userId?: string
  keyId?: string
  keyType?: 'personal' | 'workspace'
  workspaceId?: string
  error?: string
}

export interface CreatePersonalApiKeyInput {
  userId: string
  name: string
  createdAt?: Date
}

export interface CreatedPersonalApiKey {
  id: string
  name: string
  createdAt: Date
  key: string
}

export async function createApiKeyMaterial(): Promise<{
  key: string
  storedKey: string
}> {
  try {
    const key = generateApiKey()
    return { key, storedKey: getStoredApiKey(key) }
  } catch (error) {
    logger.error('API key creation error:', { error })
    throw new Error('Failed to create API key')
  }
}

export async function createPersonalApiKey({
  userId,
  name,
  createdAt = new Date(),
}: CreatePersonalApiKeyInput): Promise<CreatedPersonalApiKey> {
  const trimmedName = name.trim()
  if (!trimmedName) {
    throw new Error('API key name is required')
  }

  const keyId = nanoid()
  const { key: plainKey, storedKey } = await createApiKeyMaterial()

  const [newKey] = await db
    .insert(apiKeyTable)
    .values({
      id: keyId,
      userId,
      workspaceId: null,
      name: trimmedName,
      key: storedKey,
      type: 'personal',
      createdAt,
      updatedAt: createdAt,
    })
    .returning({
      id: apiKeyTable.id,
      name: apiKeyTable.name,
      createdAt: apiKeyTable.createdAt,
    })

  if (!newKey) {
    throw new Error('Failed to create API key')
  }

  return {
    ...newKey,
    key: plainKey,
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
  if (!API_KEY_PATTERN.test(apiKey)) {
    return { success: false, error: 'Invalid API key' }
  }

  try {
    const conditions = [eq(apiKeyTable.key, getStoredApiKey(apiKey))]

    if (options.userId) {
      conditions.push(eq(apiKeyTable.userId, options.userId))
    }

    if (options.workspaceId) {
      conditions.push(eq(apiKeyTable.workspaceId, options.workspaceId))
    }

    if (options.keyTypes?.length === 1) {
      conditions.push(eq(apiKeyTable.type, options.keyTypes[0]))
    } else if (options.keyTypes?.length) {
      conditions.push(inArray(apiKeyTable.type, options.keyTypes))
    }

    const [storedKey] = await db
      .select({
        id: apiKeyTable.id,
        userId: apiKeyTable.userId,
        workspaceId: apiKeyTable.workspaceId,
        type: apiKeyTable.type,
        expiresAt: apiKeyTable.expiresAt,
      })
      .from(apiKeyTable)
      .where(and(...conditions))
      .limit(1)

    if (!storedKey || (storedKey.expiresAt && storedKey.expiresAt < new Date())) {
      return { success: false, error: 'Invalid API key' }
    }

    return {
      success: true,
      userId: storedKey.userId,
      keyId: storedKey.id,
      keyType: storedKey.type as 'personal' | 'workspace',
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
  return `sk-tradinggoose-${nanoid(32)}`
}

export function isApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith('sk-tradinggoose-')
}

export function formatApiKeyForDisplay(apiKey: string): string {
  const last4 = apiKey.slice(-4)
  return isApiKeyFormat(apiKey) ? `sk-tradinggoose-...${last4}` : `...${last4}`
}

export function getStoredApiKey(apiKey: string): string {
  const digest = createHash('sha256').update(apiKey).digest('hex')
  return `${formatApiKeyForDisplay(apiKey)}${API_KEY_STORAGE_SEPARATOR}${digest}`
}

export function storedApiKeyMatches(apiKey: string, storedApiKey: string): boolean {
  return getStoredApiKey(apiKey) === storedApiKey
}

export function getApiKeyDisplayFormat(storedApiKey: string): string {
  const [display, digest] = storedApiKey.split(API_KEY_STORAGE_SEPARATOR)
  return display && digest ? display : '****'
}
