import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { apiKey, userRateLimits, verification } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createApiKey } from '@/lib/api-key/service'
import { env } from '@/lib/env'
import { getBaseUrl } from '@/lib/urls/utils'

const DEVICE_LOGIN_TTL_MS = 10 * 60 * 1000
const DEVICE_LOGIN_PREFIX = 'mcp:'
const DEVICE_LOGIN_START_RATE_LIMIT = 60
const DEVICE_LOGIN_START_WINDOW_MS = 60 * 1000
const POLL_INTERVAL_SECONDS = 2

type PendingDeviceLogin = {
  status: 'pending'
  createdAt: string
  verificationKeyHash: string
}

type ApprovedDeviceLogin = {
  status: 'approved'
  createdAt: string
  verificationKeyHash: string
  approvedAt: string
  userId: string
  deliveredAt?: string
}

type DeviceLoginState =
  | PendingDeviceLogin
  | ApprovedDeviceLogin
  | { status: 'cancelled'; verificationKeyHash: string }
type DeviceLogin = {
  id: string
  state: DeviceLoginState
  expiresAt: Date
}

export type McpDeviceLoginPollResult =
  | { status: 'pending'; intervalSeconds: number; expiresAt: string }
  | { status: 'approved'; apiKey: string; expiresAt: string }
  | { status: 'invalid' }
  | { status: 'expired' }

export type McpDeviceLoginApprovalResult =
  | { status: 'approved'; expiresAt: string }
  | { status: 'expired' }
  | { status: 'invalid' }

export type McpDeviceLoginApprovalChallengeResult =
  | { status: 'pending'; expiresAt: string; approvalToken: string }
  | { status: 'approved'; expiresAt: string }
  | { status: 'expired' }
  | { status: 'invalid' }

export type McpDeviceLoginStartResult = {
  code: string
  verificationKey: string
  expiresAt: string
  intervalSeconds: number
}

export class McpDeviceLoginRateLimitError extends Error {
  constructor(public resetAt: Date) {
    super('Too many MCP login starts')
    this.name = 'McpDeviceLoginRateLimitError'
  }
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function signDeviceLoginCode(unsignedCode: string): string {
  return createHmac('sha256', env.INTERNAL_API_SECRET).update(unsignedCode).digest('base64url')
}

function getDeviceLoginDeploymentScope(): string {
  return hashValue(getBaseUrl())
}

function buildDeviceLoginId(code: string): string {
  return `${DEVICE_LOGIN_PREFIX}${hashValue(`${getDeviceLoginDeploymentScope()}:${code}`)}`
}

function createDeviceLoginApprovalToken(code: string, userId: string): string {
  return signDeviceLoginCode(`mcp-approval.${buildDeviceLoginId(code)}.${userId}`)
}

function approvalTokenMatches(code: string, userId: string, approvalToken: string): boolean {
  const expectedToken = createDeviceLoginApprovalToken(code, userId)
  return (
    expectedToken.length === approvalToken.length &&
    timingSafeEqual(Buffer.from(expectedToken), Buffer.from(approvalToken))
  )
}

function signatureMatches(unsignedCode: string, signature: string): boolean {
  const expectedSignature = signDeviceLoginCode(unsignedCode)
  return (
    expectedSignature.length === signature.length &&
    timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  )
}

function createDeviceLogin({
  expiresAt,
  now,
  verificationKey,
}: {
  expiresAt: Date
  now: Date
  verificationKey: string
}) {
  const verificationKeyHash = hashValue(verificationKey)
  const unsignedCode = [
    randomBytes(32).toString('base64url'),
    String(now.getTime()),
    String(expiresAt.getTime()),
    getDeviceLoginDeploymentScope(),
    verificationKeyHash,
  ].join('.')
  const code = `${unsignedCode}.${signDeviceLoginCode(unsignedCode)}`
  return {
    code,
    id: buildDeviceLoginId(code),
    state: {
      status: 'pending',
      createdAt: now.toISOString(),
      verificationKeyHash,
    } satisfies PendingDeviceLogin,
  }
}

function parseDeviceLoginCode(code: string): DeviceLogin | null {
  const parts = code.split('.')
  if (parts.length !== 6) {
    return null
  }

  const signature = parts.at(-1)
  if (!signature) {
    return null
  }

  const unsignedCode = parts.slice(0, -1).join('.')
  if (!signatureMatches(unsignedCode, signature)) {
    return null
  }

  const [, createdAtValue, expiresAtValue, deploymentScope, verificationKeyHash] = parts
  if (
    deploymentScope !== getDeviceLoginDeploymentScope() ||
    !verificationKeyHash ||
    !createdAtValue ||
    !expiresAtValue
  ) {
    return null
  }

  const createdAtTime = Number(createdAtValue)
  const expiresAtTime = Number(expiresAtValue)
  if (!Number.isFinite(createdAtTime) || !Number.isFinite(expiresAtTime)) {
    return null
  }

  const expiresAt = new Date(expiresAtTime)
  if (expiresAt <= new Date()) {
    return null
  }

  return {
    id: buildDeviceLoginId(code),
    state: {
      status: 'pending',
      createdAt: new Date(createdAtTime).toISOString(),
      verificationKeyHash,
    },
    expiresAt,
  }
}

function deviceLoginMatches(login: DeviceLogin, state = login.state) {
  return and(eq(verification.id, login.id), eq(verification.value, JSON.stringify(state)))
}

function parseDeviceLoginState(value: string): DeviceLoginState | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      parsed.status === 'pending' &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.verificationKeyHash === 'string'
    ) {
      return parsed as PendingDeviceLogin
    }
    if (
      parsed.status === 'approved' &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.verificationKeyHash === 'string' &&
      typeof parsed.approvedAt === 'string' &&
      typeof parsed.userId === 'string' &&
      (parsed.deliveredAt === undefined || typeof parsed.deliveredAt === 'string')
    ) {
      return parsed as ApprovedDeviceLogin
    }
    if (parsed.status === 'cancelled' && typeof parsed.verificationKeyHash === 'string') {
      return parsed as DeviceLoginState
    }
    return null
  } catch {
    return null
  }
}

async function readDeviceLogin(code: string) {
  const parsedLogin = parseDeviceLoginCode(code)
  if (!parsedLogin) {
    return null
  }

  const [row] = await db
    .select({
      id: verification.id,
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(eq(verification.id, parsedLogin.id))
    .limit(1)

  if (!row) {
    return null
  }

  const state = parseDeviceLoginState(row.value)
  if (!state || row.expiresAt <= new Date()) {
    await db.delete(verification).where(eq(verification.id, row.id))
    return null
  }

  return {
    id: row.id,
    state,
    expiresAt: row.expiresAt,
  }
}

async function updateDeviceLoginState(
  login: DeviceLogin,
  nextState: DeviceLoginState
): Promise<boolean> {
  const [updated] = await db
    .update(verification)
    .set({
      value: JSON.stringify(nextState),
      updatedAt: new Date(),
    })
    .where(deviceLoginMatches(login))
    .returning({ id: verification.id })

  return Boolean(updated)
}

async function enforceDeviceLoginStartRateLimit(now: Date) {
  const windowStart = new Date(now.getTime() - DEVICE_LOGIN_START_WINDOW_MS)
  const [record] = await db
    .insert(userRateLimits)
    .values({
      referenceId: `${DEVICE_LOGIN_PREFIX}start:${getDeviceLoginDeploymentScope()}`,
      syncApiRequests: 0,
      asyncApiRequests: 0,
      apiEndpointRequests: 1,
      windowStart: now,
      lastRequestAt: now,
      isRateLimited: false,
      rateLimitResetAt: null,
    })
    .onConflictDoUpdate({
      target: userRateLimits.referenceId,
      set: {
        apiEndpointRequests: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN 1 ELSE ${userRateLimits.apiEndpointRequests} + 1 END`,
        windowStart: sql`CASE WHEN ${userRateLimits.windowStart} < ${windowStart.toISOString()} THEN ${now.toISOString()} ELSE ${userRateLimits.windowStart} END`,
        lastRequestAt: now,
      },
    })
    .returning({
      apiEndpointRequests: userRateLimits.apiEndpointRequests,
      windowStart: userRateLimits.windowStart,
    })

  if (!record || record.apiEndpointRequests <= DEVICE_LOGIN_START_RATE_LIMIT) {
    return
  }

  throw new McpDeviceLoginRateLimitError(
    new Date(new Date(record.windowStart).getTime() + DEVICE_LOGIN_START_WINDOW_MS)
  )
}

export async function startMcpDeviceLogin(): Promise<McpDeviceLoginStartResult> {
  const verificationKey = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_LOGIN_TTL_MS)
  const login = createDeviceLogin({ expiresAt, now, verificationKey })

  await enforceDeviceLoginStartRateLimit(now)
  await db.insert(verification).values({
    id: login.id,
    identifier: login.id,
    value: JSON.stringify(login.state),
    expiresAt: login.expiresAt,
    createdAt: now,
    updatedAt: now,
  })

  return {
    code: login.code,
    verificationKey,
    expiresAt: expiresAt.toISOString(),
    intervalSeconds: POLL_INTERVAL_SECONDS,
  }
}

export async function createMcpDeviceLoginApprovalChallenge({
  code,
  userId,
}: {
  code: string
  userId: string
}): Promise<McpDeviceLoginApprovalChallengeResult> {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.status === 'approved') {
    if (login.state.userId !== userId) {
      return { status: 'invalid' }
    }
    if (login.state.deliveredAt) {
      return { status: 'expired' }
    }
    return {
      status: 'approved',
      expiresAt: login.expiresAt.toISOString(),
    }
  }
  if (login.state.status !== 'pending') {
    return { status: 'expired' }
  }

  return {
    status: 'pending',
    expiresAt: login.expiresAt.toISOString(),
    approvalToken: createDeviceLoginApprovalToken(code, userId),
  }
}

export async function pollMcpDeviceLogin(
  code: string,
  verificationKey: string
): Promise<McpDeviceLoginPollResult> {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.verificationKeyHash !== hashValue(verificationKey)) {
    return { status: 'invalid' }
  }

  if (login.state.status === 'approved' && login.state.deliveredAt) {
    return { status: 'expired' }
  }

  if (login.state.status === 'pending') {
    return {
      status: 'pending',
      intervalSeconds: POLL_INTERVAL_SECONDS,
      expiresAt: login.expiresAt.toISOString(),
    }
  }
  if (login.state.status !== 'approved') {
    return { status: 'expired' }
  }

  const approvedState = login.state
  const now = new Date()
  const { key, encryptedKey } = await createApiKey(true)
  if (!encryptedKey) {
    throw new Error('Failed to encrypt API key for storage')
  }
  const delivered = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(verification)
      .set({
        value: JSON.stringify({
          ...approvedState,
          deliveredAt: now.toISOString(),
        } satisfies ApprovedDeviceLogin),
        updatedAt: now,
      })
      .where(deviceLoginMatches(login))
      .returning({ id: verification.id })
    if (!updated) {
      return false
    }
    await tx.insert(apiKey).values({
      id: nanoid(),
      userId: approvedState.userId,
      workspaceId: null,
      name: `TradingGoose MCP Access ${now.toISOString()}`,
      key: encryptedKey,
      type: 'personal',
      createdAt: now,
      updatedAt: now,
    })
    return true
  })
  if (!delivered) {
    return {
      status: 'pending',
      intervalSeconds: POLL_INTERVAL_SECONDS,
      expiresAt: login.expiresAt.toISOString(),
    }
  }

  return {
    status: 'approved',
    apiKey: key,
    expiresAt: login.expiresAt.toISOString(),
  }
}
export async function approveMcpDeviceLogin({
  approvalToken,
  code,
  userId,
}: {
  approvalToken: string
  code: string
  userId: string
}): Promise<McpDeviceLoginApprovalResult> {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.status === 'approved') {
    if (login.state.userId !== userId || login.state.deliveredAt) {
      return { status: 'invalid' }
    }
    return {
      status: 'approved',
      expiresAt: login.expiresAt.toISOString(),
    }
  }
  if (login.state.status !== 'pending') {
    return { status: 'invalid' }
  }

  if (!approvalTokenMatches(code, userId, approvalToken)) {
    return { status: 'invalid' }
  }

  const now = new Date()
  const approvedAt = now.toISOString()
  const approvedState = {
    status: 'approved',
    createdAt: login.state.createdAt,
    verificationKeyHash: login.state.verificationKeyHash,
    approvedAt,
    userId,
  } satisfies ApprovedDeviceLogin

  if (!(await updateDeviceLoginState(login, approvedState))) {
    return { status: 'invalid' }
  }

  return {
    status: 'approved',
    expiresAt: login.expiresAt.toISOString(),
  }
}

export async function cancelMcpDeviceLogin({
  approvalToken,
  code,
  userId,
}: {
  approvalToken: string
  code: string
  userId: string
}) {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.status !== 'pending') {
    return { status: 'invalid' }
  }

  if (!approvalTokenMatches(code, userId, approvalToken)) {
    return { status: 'invalid' }
  }

  const [updated] = await db
    .update(verification)
    .set({
      value: JSON.stringify({
        status: 'cancelled',
        verificationKeyHash: login.state.verificationKeyHash,
      }),
      updatedAt: new Date(),
    })
    .where(deviceLoginMatches(login))
    .returning({ id: verification.id })

  if (!updated) {
    return { status: 'invalid' }
  }

  return { status: 'cancelled' }
}
