import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UtilsServer')
const HEX_KEY_REGEX = /^[0-9a-fA-F]{64}$/
const BASE64_KEY_REGEX = /^[0-9a-zA-Z+/=]+$/

type NonHexKeyFormat = 'base64' | 'utf8'
let encryptionKeyWarningType: NonHexKeyFormat | null = null

function warnAboutEncryptionKey(format: NonHexKeyFormat) {
  if (encryptionKeyWarningType === format) {
    return
  }

  encryptionKeyWarningType = format
  const message =
    format === 'base64'
      ? 'ENCRYPTION_KEY appears to be base64 encoded. Please switch to a 64-character hex string generated with `openssl rand -hex 32`.'
      : 'ENCRYPTION_KEY is not a 64-character hex string. Falling back to raw string bytes for backward compatibility – please update your configuration.'
  logger.warn(message)
}

function decodeBase64Key(key: string): Buffer | null {
  if (key.length % 4 !== 0 || !BASE64_KEY_REGEX.test(key)) {
    return null
  }

  try {
    const decoded = Buffer.from(key, 'base64')
    return decoded.length === 32 ? decoded : null
  } catch {
    return null
  }
}

function getEncryptionKey(): Buffer {
  const rawKey = env.ENCRYPTION_KEY?.trim()
  if (!rawKey) {
    throw new Error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  }

  if (HEX_KEY_REGEX.test(rawKey)) {
    return Buffer.from(rawKey, 'hex')
  }

  const base64Key = decodeBase64Key(rawKey)
  if (base64Key) {
    warnAboutEncryptionKey('base64')
    return base64Key
  }

  const utf8Buffer = Buffer.from(rawKey, 'utf8')
  if (utf8Buffer.length === 32) {
    warnAboutEncryptionKey('utf8')
    return utf8Buffer
  }

  throw new Error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
}

export async function encryptSecret(secret: string): Promise<{ encrypted: string; iv: string }> {
  const iv = randomBytes(16)
  const key = getEncryptionKey()

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(secret, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return {
    encrypted: `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`,
    iv: iv.toString('hex'),
  }
}

export async function decryptSecret(encryptedValue: string): Promise<{ decrypted: string }> {
  const parts = encryptedValue.split(':')
  const ivHex = parts[0]
  const authTagHex = parts[parts.length - 1]
  const encrypted = parts.slice(1, -1).join(':')

  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
  }

  const key = getEncryptionKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return { decrypted }
  } catch (error: any) {
    logger.error('Decryption error:', { error: error.message })
    throw error
  }
}

export async function getRotatingApiKey(provider: string): Promise<string> {
  if (provider !== 'openai' && provider !== 'anthropic') {
    throw new Error(`No rotation implemented for provider: ${provider}`)
  }

  if (provider === 'openai') {
    const { resolveOpenAIServiceConfig } = await import('@/lib/system-services/runtime')
    const config = await resolveOpenAIServiceConfig()
    return pickRotatingApiKey(config.rotationKeys, provider)
  }

  const { resolveAnthropicServiceConfig } = await import('@/lib/system-services/runtime')
  const config = await resolveAnthropicServiceConfig()
  return pickRotatingApiKey(config.rotationKeys, provider)
}

function pickRotatingApiKey(keys: string[], provider: string): string {
  if (keys.length === 0) {
    throw new Error(
      `No API keys configured for rotation. Please configure ${provider} service rotation keys 1-3 in admin services.`
    )
  }

  const currentMinute = new Date().getMinutes()
  const keyIndex = currentMinute % keys.length

  return keys[keyIndex]
}
