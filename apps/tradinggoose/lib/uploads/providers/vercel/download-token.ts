import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'

const VERCEL_DOWNLOAD_AUDIENCE = 'tradinggoose-vercel-download'
const VERCEL_DOWNLOAD_ISSUER = 'tradinggoose-internal'
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' } as const

interface VercelDownloadTokenPayload {
  aud: string
  exp: number
  iat: number
  iss: string
  key: string
  type: 'vercel-download'
  context?: StorageContext
}

export interface VercelDownloadClaims {
  key: string
  context?: StorageContext
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signToken(unsignedToken: string): string {
  return createHmac('sha256', env.INTERNAL_API_SECRET).update(unsignedToken).digest('base64url')
}

export async function createVercelDownloadToken(
  claims: VercelDownloadClaims,
  expiresIn: number
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: VercelDownloadTokenPayload = {
    aud: VERCEL_DOWNLOAD_AUDIENCE,
    exp: issuedAt + Math.max(1, expiresIn),
    iat: issuedAt,
    iss: VERCEL_DOWNLOAD_ISSUER,
    key: claims.key,
    type: 'vercel-download',
  }

  if (claims.context) {
    payload.context = claims.context
  }

  const encodedHeader = encodeBase64Url(JSON.stringify(JWT_HEADER))
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const unsignedToken = `${encodedHeader}.${encodedPayload}`

  return `${unsignedToken}.${signToken(unsignedToken)}`
}

export async function verifyVercelDownloadToken(
  token: string
): Promise<VercelDownloadClaims | null> {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')

    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return null
    }

    const unsignedToken = `${encodedHeader}.${encodedPayload}`
    const expectedSignature = signToken(unsignedToken)
    const signatureMatches =
      expectedSignature.length === encodedSignature.length &&
      timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(encodedSignature))

    if (!signatureMatches) {
      return null
    }

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<VercelDownloadTokenPayload>
    const now = Math.floor(Date.now() / 1000)

    if (
      payload.type !== 'vercel-download' ||
      payload.iss !== VERCEL_DOWNLOAD_ISSUER ||
      payload.aud !== VERCEL_DOWNLOAD_AUDIENCE ||
      typeof payload.key !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now
    ) {
      return null
    }

    return {
      key: payload.key,
      context: typeof payload.context === 'string' ? (payload.context as StorageContext) : undefined,
    }
  } catch {
    return null
  }
}
