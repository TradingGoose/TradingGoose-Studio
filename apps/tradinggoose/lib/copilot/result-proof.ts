import { createHash } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import { type ProofClaims, parseNativeContract } from '@/lib/copilot/native/contract'
import { isToolId } from '@/lib/copilot/registry'
import { env } from '@/lib/env'
import { stableStringifyJsonValue } from '@/lib/json/stable'

const TYPE = 'copilot-tool-result'
const ISSUER = 'tradinggoose-studio'
const AUDIENCE = 'tradinggoose-copilot-result'
const LIFETIME_SECONDS = 300
export type CopilotToolResultBinding = Omit<
  ProofClaims,
  'type' | 'iss' | 'aud' | 'iat' | 'exp' | 'argsDigest' | 'resultDigest'
>
export interface CopilotToolResultEvidence {
  binding: CopilotToolResultBinding
  originalArgs: unknown
  result: unknown
}

function secret() {
  if (!env.INTERNAL_API_SECRET) throw new Error('INTERNAL_API_SECRET is required')
  return new TextEncoder().encode(env.INTERNAL_API_SECRET)
}

// Accept decoded JSON only: JSON.stringify must not silently drop or convert data.
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || !value) throw new Error('Result proof requires complete JSON')
  const prototype = Object.getPrototypeOf(value)
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    throw new Error('Result proof requires plain JSON objects')
  }
  if (ancestors.has(value)) throw new Error('Result proof cannot contain cyclic JSON')
  ancestors.add(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const expectedKeys = Array.isArray(value)
    ? [...Array(value.length).keys()].map(String)
    : Object.keys(value)
  const keys = Reflect.ownKeys(value).filter((key) => key !== 'length' || !Array.isArray(value))
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(String(key)))
  ) {
    throw new Error('Result proof requires complete JSON properties')
  }
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new Error('Result proof cannot contain accessors or omitted JSON properties')
    }
    assertJson(descriptor.value, ancestors)
  }
  ancestors.delete(value)
}

function evidenceDigests({ originalArgs, result }: CopilotToolResultEvidence) {
  if (!originalArgs || typeof originalArgs !== 'object' || Array.isArray(originalArgs)) {
    throw new Error('Tool result proof requires the original business argument object')
  }
  if (
    ['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background'].some(
      (key) => key in originalArgs
    )
  ) {
    throw new Error('Native execution fields cannot be business tool arguments')
  }
  assertJson(originalArgs)
  assertJson(result)
  if (result && typeof result === 'object' && 'requiresReview' in result && result.requiresReview) {
    throw new Error('A business review preview is not a completed tool result')
  }
  const digest = (value: unknown) =>
    createHash('sha256').update(stableStringifyJsonValue(value)).digest('hex')
  return { argsDigest: digest(originalArgs), resultDigest: digest(result) }
}

/** Caller must first verify the genuine pending target, current permission and financial binding. */
export async function createCopilotToolResultProof(evidence: CopilotToolResultEvidence) {
  const digests = evidenceDigests(evidence)
  const now = Math.floor(Date.now() / 1000)
  const claims = await parseNativeContract('ProofClaims', {
    type: TYPE,
    ...evidence.binding,
    ...digests,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + LIFETIME_SECONDS,
  })
  if (!isToolId(claims.toolName)) throw new Error('Unknown Copilot business tool')
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256' }).sign(secret())
}

/** Cryptographic provenance only; callers must freshly recheck native/business authorization. */
export async function verifyCopilotToolResultProof(
  proof: string,
  evidence: CopilotToolResultEvidence
): Promise<void> {
  const digests = evidenceDigests(evidence)
  const { payload } = await jwtVerify(proof, secret(), {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
    requiredClaims: ['iat', 'exp'],
    maxTokenAge: LIFETIME_SECONDS,
  })
  const claims = await parseNativeContract('ProofClaims', payload)
  const expected = await parseNativeContract('ProofClaims', {
    ...claims,
    ...evidence.binding,
    ...digests,
  })
  if (
    !isToolId(claims.toolName) ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > LIFETIME_SECONDS ||
    stableStringifyJsonValue(expected) !== stableStringifyJsonValue(claims)
  ) {
    throw new Error('Tool result proof does not match the current native target and result')
  }
}
