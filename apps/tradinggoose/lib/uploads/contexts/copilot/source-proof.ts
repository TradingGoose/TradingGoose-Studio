import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { env } from '@/lib/env'
import { assertPublicStorageInput } from '@/lib/uploads/archive-boundary'
import { getStorageConfig } from '@/lib/uploads/core/config-resolver'
import { getStorageProvider } from '@/lib/uploads/core/setup'

export const COPILOT_SOURCE_LIFETIME_SECONDS = 3600
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'copilot-source' })).toString(
  'base64url'
)
const claimsSchema = z
  .object({
    iss: z.literal('tradinggoose-studio'),
    aud: z.literal('copilot-source-ingress'),
    context: z.literal('copilot'),
    actorUserId: z.string().min(1),
    key: z.string().min(1).max(2048),
    filename: z.string().min(1).max(1024),
    mediaType: z.string().min(1),
    size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    storageIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict()
export type CopilotSourceClaims = z.infer<typeof claimsSchema>

export class CopilotSourceError extends Error {
  constructor(
    message: string,
    public status = 403
  ) {
    super(message)
    this.name = 'CopilotSourceError'
  }
}

function sign(value: string) {
  return createHmac('sha256', env.INTERNAL_API_SECRET).update(value).digest('base64url')
}

/** Storage configuration is bound without serializing its credentials into the reference. */
export async function copilotStorageIdentity() {
  const provider = getStorageProvider()
  const config = getStorageConfig('copilot')
  const localRoot =
    provider === 'local'
      ? (await import('@/lib/uploads/core/local-path')).UPLOAD_DIR_SERVER
      : undefined
  return createHmac('sha256', env.INTERNAL_API_SECRET)
    .update(JSON.stringify({ provider, config, localRoot }))
    .digest('hex')
}

/** A routing classification only. It never grants ownership. */
export function isCopilotSourceReference(value: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return true
  }
  return /(?:^|\/)copilot\//.test(decoded)
}

/** Called only after the authenticated server upload and exact stored-byte readback. */
export async function signCopilotSource(
  source: Pick<
    CopilotSourceClaims,
    'actorUserId' | 'key' | 'filename' | 'mediaType' | 'size' | 'sha256'
  >
) {
  assertPublicStorageInput(source.key, 'copilot')
  if (!source.key.startsWith('copilot/'))
    throw new CopilotSourceError('Invalid Copilot allocation', 400)
  const now = Math.floor(Date.now() / 1000)
  const claims = claimsSchema.parse({
    ...source,
    iss: 'tradinggoose-studio',
    aud: 'copilot-source-ingress',
    context: 'copilot',
    storageIdentity: await copilotStorageIdentity(),
    iat: now,
    exp: now + COPILOT_SOURCE_LIFETIME_SECONDS,
  })
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const unsigned = `${header}.${payload}`
  return {
    sourceProof: `${unsigned}.${sign(unsigned)}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  }
}

export async function verifyCopilotSource(sourceProof: string): Promise<CopilotSourceClaims> {
  try {
    const [providedHeader, payload, signature, extra] = sourceProof.split('.')
    if (extra !== undefined || providedHeader !== header || !payload || !signature)
      throw new Error('Invalid source authorization')
    const expected = sign(`${providedHeader}.${payload}`)
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new Error('Invalid source authorization')
    const claims = claimsSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    )
    const now = Math.floor(Date.now() / 1000)
    if (
      claims.iat > now ||
      claims.exp <= now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > COPILOT_SOURCE_LIFETIME_SECONDS ||
      claims.storageIdentity !== (await copilotStorageIdentity())
    )
      throw new Error('Invalid source authorization')
    assertPublicStorageInput(claims.key, 'copilot')
    if (!claims.key.startsWith('copilot/')) throw new Error('Invalid source authorization')
    return claims
  } catch {
    throw new CopilotSourceError(
      'Attachment authorization is invalid or expired; upload the image again'
    )
  }
}
