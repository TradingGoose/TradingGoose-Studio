import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { apiKey, verification } from '@tradinggoose/db/schema'
import { and, eq, like, lte } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { encryptApiKeyForStorage, isApiKeyFormat } from '@/lib/api-key/service'
import { env } from '@/lib/env'
import { getBaseUrl } from '@/lib/urls/utils'

const DEVICE_LOGIN_TTL_MS = 10 * 60 * 1000
const DEVICE_LOGIN_PREFIX = 'mcp:'
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
  apiKeyHash?: string
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
type PendingDeviceLoginRecord = DeviceLogin & { state: PendingDeviceLogin }

export type McpDeviceLoginPollResult =
  | { status: 'pending'; intervalSeconds: number; expiresAt: string }
  | { status: 'approved'; apiKey: string; expiresAt: string }
  | { status: 'invalid' }
  | { status: 'expired' }

export type McpDeviceLoginAckResult =
  | { status: 'acknowledged' }
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

function createDeviceLoginApiKey(code: string, verificationKey: string): string {
  const secret = createHmac('sha256', env.INTERNAL_API_SECRET)
    .update(`mcp-api-key.${buildDeviceLoginId(code)}.${hashValue(verificationKey)}`)
    .digest('base64url')
    .slice(0, 32)
  return `${env.API_ENCRYPTION_KEY !== undefined ? 'sk-tradinggoose-' : 'tradinggoose_'}${secret}`
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
    expiresAt,
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
      (parsed.apiKeyHash === undefined || typeof parsed.apiKeyHash === 'string') &&
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

function isPendingDeviceLoginRecord(login: DeviceLogin): login is PendingDeviceLoginRecord {
  return login.state.status === 'pending'
}

async function readPersistedDeviceLogin(login: DeviceLogin, now: Date) {
  const [row] = await db
    .select({
      id: verification.id,
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(eq(verification.id, login.id))
    .limit(1)

  if (!row) {
    return null
  }

  const state = parseDeviceLoginState(row.value)
  if (!state || row.expiresAt <= now) {
    await db.delete(verification).where(eq(verification.id, row.id))
    return null
  }

  return {
    id: row.id,
    state,
    expiresAt: row.expiresAt,
  }
}

async function readDeviceLogin(code: string) {
  const parsedLogin = parseDeviceLoginCode(code)
  if (!parsedLogin) {
    return null
  }

  const now = new Date()
  if (parsedLogin.expiresAt <= now) {
    await db.delete(verification).where(eq(verification.id, parsedLogin.id))
    return null
  }

  return (await readPersistedDeviceLogin(parsedLogin, now)) ?? parsedLogin
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

async function deleteExpiredDeviceLogins(now: Date) {
  await db
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${DEVICE_LOGIN_PREFIX}%`),
        lte(verification.expiresAt, now)
      )
    )
}

async function persistPendingDeviceLogin(login: PendingDeviceLoginRecord, now: Date) {
  await deleteExpiredDeviceLogins(now)
  await db
    .insert(verification)
    .values({
      id: login.id,
      identifier: login.id,
      value: JSON.stringify(login.state),
      expiresAt: login.expiresAt,
      createdAt: new Date(login.state.createdAt),
      updatedAt: now,
    })
    .onConflictDoNothing({ target: verification.id })

  return readPersistedDeviceLogin(login, now)
}

export async function startMcpDeviceLogin(): Promise<McpDeviceLoginStartResult> {
  const verificationKey = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_LOGIN_TTL_MS)
  const login = createDeviceLogin({ expiresAt, now, verificationKey })

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
  const parsedLogin = await readDeviceLogin(code)
  if (!parsedLogin) {
    return { status: 'expired' }
  }
  const login = isPendingDeviceLoginRecord(parsedLogin)
    ? await persistPendingDeviceLogin(parsedLogin, new Date())
    : parsedLogin
  if (!login) return { status: 'expired' }

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

  const key = createDeviceLoginApiKey(code, verificationKey)
  const apiKeyHash = hashValue(key)
  if (login.state.apiKeyHash === apiKeyHash) {
    return {
      status: 'approved',
      apiKey: key,
      expiresAt: login.expiresAt.toISOString(),
    }
  }

  const nextState = {
    ...login.state,
    apiKeyHash,
  } satisfies ApprovedDeviceLogin
  if (!(await updateDeviceLoginState(login, nextState))) {
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

export async function acknowledgeMcpDeviceLogin({
  apiKey: plainApiKey,
  code,
  verificationKey,
}: {
  apiKey: string
  code: string
  verificationKey: string
}): Promise<McpDeviceLoginAckResult> {
  if (!isApiKeyFormat(plainApiKey)) {
    return { status: 'invalid' }
  }

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

  if (login.state.status !== 'approved') {
    return { status: 'invalid' }
  }
  if (login.state.apiKeyHash !== hashValue(plainApiKey)) {
    return { status: 'invalid' }
  }

  const now = new Date()
  const { apiKeyHash: _apiKeyHash, ...approvedState } = login.state
  const encryptedKey = await encryptApiKeyForStorage(plainApiKey)
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
      type: 'mcp',
      createdAt: now,
      updatedAt: now,
    })
    return true
  })
  if (!delivered) {
    return { status: 'invalid' }
  }

  return { status: 'acknowledged' }
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
