import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'

const VERCEL_UPLOAD_AUDIENCE = 'tradinggoose-vercel-upload'
const VERCEL_UPLOAD_ISSUER = 'tradinggoose-internal'
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' } as const

interface VercelUploadTokenPayload {
  aud: string
  contentType: string
  context: StorageContext
  exp: number
  iat: number
  iss: string
  pathname: string
  size: number
  type: 'vercel-upload'
  userId: string
}

export interface VercelUploadClaims {
  contentType: string
  context: StorageContext
  pathname: string
  size: number
  userId: string
}

export interface VerifiedVercelUploadClaims extends VercelUploadClaims {
  exp: number
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

export async function createVercelUploadToken(
  claims: VercelUploadClaims,
  expiresIn: number
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: VercelUploadTokenPayload = {
    aud: VERCEL_UPLOAD_AUDIENCE,
    contentType: claims.contentType,
    context: claims.context,
    exp: issuedAt + Math.max(1, expiresIn),
    iat: issuedAt,
    iss: VERCEL_UPLOAD_ISSUER,
    pathname: claims.pathname,
    size: claims.size,
    type: 'vercel-upload',
    userId: claims.userId,
  }

  const encodedHeader = encodeBase64Url(JSON.stringify(JWT_HEADER))
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const unsignedToken = `${encodedHeader}.${encodedPayload}`

  return `${unsignedToken}.${signToken(unsignedToken)}`
}

export async function verifyVercelUploadToken(
  token: string
): Promise<VerifiedVercelUploadClaims | null> {
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

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<VercelUploadTokenPayload>
    const now = Math.floor(Date.now() / 1000)

    if (
      payload.type !== 'vercel-upload' ||
      payload.iss !== VERCEL_UPLOAD_ISSUER ||
      payload.aud !== VERCEL_UPLOAD_AUDIENCE ||
      typeof payload.pathname !== 'string' ||
      typeof payload.contentType !== 'string' ||
      typeof payload.size !== 'number' ||
      typeof payload.userId !== 'string' ||
      typeof payload.context !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now
    ) {
      return null
    }

    return {
      contentType: payload.contentType,
      context: payload.context as StorageContext,
      exp: payload.exp,
      pathname: payload.pathname,
      size: payload.size,
      userId: payload.userId,
    }
  } catch {
    return null
  }
}
