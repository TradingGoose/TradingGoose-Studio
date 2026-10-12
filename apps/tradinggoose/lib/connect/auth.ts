import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { apiKey, verification } from '@tradinggoose/db/schema'
import { and, eq, like, lte } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getStoredApiKey, isApiKeyFormat } from '@/lib/api-key/service'
import { env } from '@/lib/env'
import { getBaseUrl } from '@/lib/urls/utils'

const CONNECTION_LOGIN_TTL_MS = 10 * 60 * 1000
const CONNECTION_LOGIN_PREFIX = 'connection:'
const POLL_INTERVAL_SECONDS = 2

type PendingConnectionLogin = {
  status: 'pending'
  createdAt: string
  verificationKeyHash: string
}

type ApprovedConnectionLogin = {
  status: 'approved'
  createdAt: string
  verificationKeyHash: string
  approvedAt: string
  userId: string
  apiKeyHash?: string
  deliveredAt?: string
}

type ConnectionLoginState =
  | PendingConnectionLogin
  | ApprovedConnectionLogin
  | { status: 'cancelled'; verificationKeyHash: string }
type ConnectionLogin = {
  id: string
  state: ConnectionLoginState
  expiresAt: Date
}
type PendingConnectionLoginRecord = ConnectionLogin & { state: PendingConnectionLogin }

export type ConnectionLoginPollResult =
  | { status: 'pending'; intervalSeconds: number; expiresAt: string }
  | { status: 'approved'; apiKey: string; expiresAt: string }
  | { status: 'invalid' }
  | { status: 'expired' }

export type ConnectionLoginAckResult =
  | { status: 'acknowledged' }
  | { status: 'invalid' }
  | { status: 'expired' }

export type ConnectionLoginApprovalResult =
  | { status: 'approved'; expiresAt: string }
  | { status: 'expired' }
  | { status: 'invalid' }

export type ConnectionLoginApprovalChallengeResult =
  | { status: 'pending'; expiresAt: string; approvalToken: string }
  | { status: 'approved'; expiresAt: string }
  | { status: 'expired' }
  | { status: 'invalid' }

export type ConnectionLoginStartResult = {
  code: string
  verificationKey: string
  expiresAt: string
  intervalSeconds: number
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function hashValueMatches(value: string, expectedHash: string | undefined): boolean {
  const actualHash = hashValue(value)
  return (
    !!expectedHash &&
    actualHash.length === expectedHash.length &&
    timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash))
  )
}

function signConnectionLoginCode(unsignedCode: string): string {
  return createHmac('sha256', env.INTERNAL_API_SECRET).update(unsignedCode).digest('base64url')
}

function getConnectionLoginDeploymentScope(): string {
  return hashValue(getBaseUrl())
}

function buildConnectionLoginId(code: string): string {
  return `${CONNECTION_LOGIN_PREFIX}${hashValue(`${getConnectionLoginDeploymentScope()}:${code}`)}`
}

function createConnectionLoginApprovalToken(code: string, userId: string): string {
  return signConnectionLoginCode(`connection-approval.${buildConnectionLoginId(code)}.${userId}`)
}

function createConnectionLoginApiKey(code: string, verificationKey: string): string {
  const secret = createHmac('sha256', env.INTERNAL_API_SECRET)
    .update(`connection-api-key.${buildConnectionLoginId(code)}.${hashValue(verificationKey)}`)
    .digest('base64url')
    .slice(0, 32)
  return `sk-tradinggoose-${secret}`
}

function approvalTokenMatches(code: string, userId: string, approvalToken: string): boolean {
  const expectedToken = createConnectionLoginApprovalToken(code, userId)
  return (
    expectedToken.length === approvalToken.length &&
    timingSafeEqual(Buffer.from(expectedToken), Buffer.from(approvalToken))
  )
}

function signatureMatches(unsignedCode: string, signature: string): boolean {
  const expectedSignature = signConnectionLoginCode(unsignedCode)
  return (
    expectedSignature.length === signature.length &&
    timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  )
}

function createConnectionLogin({
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
    getConnectionLoginDeploymentScope(),
    verificationKeyHash,
  ].join('.')
  const code = `${unsignedCode}.${signConnectionLoginCode(unsignedCode)}`
  return {
    code,
    id: buildConnectionLoginId(code),
    expiresAt,
    state: {
      status: 'pending',
      createdAt: now.toISOString(),
      verificationKeyHash,
    } satisfies PendingConnectionLogin,
  }
}

function parseConnectionLoginCode(code: string): ConnectionLogin | null {
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
    deploymentScope !== getConnectionLoginDeploymentScope() ||
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
    id: buildConnectionLoginId(code),
    state: {
      status: 'pending',
      createdAt: new Date(createdAtTime).toISOString(),
      verificationKeyHash,
    },
    expiresAt,
  }
}

function connectionLoginMatches(login: ConnectionLogin, state = login.state) {
  return and(eq(verification.id, login.id), eq(verification.value, JSON.stringify(state)))
}

function parseConnectionLoginState(value: string): ConnectionLoginState | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      parsed.status === 'pending' &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.verificationKeyHash === 'string'
    ) {
      return parsed as PendingConnectionLogin
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
      return parsed as ApprovedConnectionLogin
    }
    if (parsed.status === 'cancelled' && typeof parsed.verificationKeyHash === 'string') {
      return parsed as ConnectionLoginState
    }
    return null
  } catch {
    return null
  }
}

function isPendingConnectionLoginRecord(
  login: ConnectionLogin
): login is PendingConnectionLoginRecord {
  return login.state.status === 'pending'
}

async function readPersistedConnectionLogin(login: ConnectionLogin, now: Date) {
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

  const state = parseConnectionLoginState(row.value)
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

async function readConnectionLogin(code: string) {
  const parsedLogin = parseConnectionLoginCode(code)
  if (!parsedLogin) {
    return null
  }

  const now = new Date()
  if (parsedLogin.expiresAt <= now) {
    await db.delete(verification).where(eq(verification.id, parsedLogin.id))
    return null
  }

  return (await readPersistedConnectionLogin(parsedLogin, now)) ?? parsedLogin
}

async function updateConnectionLoginState(
  login: ConnectionLogin,
  nextState: ConnectionLoginState
): Promise<boolean> {
  const [updated] = await db
    .update(verification)
    .set({
      value: JSON.stringify(nextState),
      updatedAt: new Date(),
    })
    .where(connectionLoginMatches(login))
    .returning({ id: verification.id })

  return Boolean(updated)
}

async function deleteExpiredConnectionLogins(now: Date) {
  await db
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${CONNECTION_LOGIN_PREFIX}%`),
        lte(verification.expiresAt, now)
      )
    )
}

async function persistPendingConnectionLogin(login: PendingConnectionLoginRecord, now: Date) {
  await deleteExpiredConnectionLogins(now)
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

  return readPersistedConnectionLogin(login, now)
}

export async function startConnectionLogin(): Promise<ConnectionLoginStartResult> {
  const verificationKey = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CONNECTION_LOGIN_TTL_MS)
  const login = createConnectionLogin({ expiresAt, now, verificationKey })

  return {
    code: login.code,
    verificationKey,
    expiresAt: expiresAt.toISOString(),
    intervalSeconds: POLL_INTERVAL_SECONDS,
  }
}

export async function createConnectionLoginApprovalChallenge({
  code,
  userId,
}: {
  code: string
  userId: string
}): Promise<ConnectionLoginApprovalChallengeResult> {
  const parsedLogin = await readConnectionLogin(code)
  if (!parsedLogin) {
    return { status: 'expired' }
  }
  const login = isPendingConnectionLoginRecord(parsedLogin)
    ? await persistPendingConnectionLogin(parsedLogin, new Date())
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
    approvalToken: createConnectionLoginApprovalToken(code, userId),
  }
}

export async function pollConnectionLogin(
  code: string,
  verificationKey: string
): Promise<ConnectionLoginPollResult> {
  const login = await readConnectionLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (!hashValueMatches(verificationKey, login.state.verificationKeyHash)) {
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

  const key = createConnectionLoginApiKey(code, verificationKey)
  const apiKeyHash = hashValue(key)
  if (hashValueMatches(key, login.state.apiKeyHash)) {
    return {
      status: 'approved',
      apiKey: key,
      expiresAt: login.expiresAt.toISOString(),
    }
  }

  const nextState = {
    ...login.state,
    apiKeyHash,
  } satisfies ApprovedConnectionLogin
  if (!(await updateConnectionLoginState(login, nextState))) {
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

export async function acknowledgeConnectionLogin({
  apiKey: plainApiKey,
  code,
  verificationKey,
}: {
  apiKey: string
  code: string
  verificationKey: string
}): Promise<ConnectionLoginAckResult> {
  if (!isApiKeyFormat(plainApiKey)) {
    return { status: 'invalid' }
  }

  const login = await readConnectionLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (!hashValueMatches(verificationKey, login.state.verificationKeyHash)) {
    return { status: 'invalid' }
  }

  if (login.state.status === 'approved' && login.state.deliveredAt) {
    return hashValueMatches(
      plainApiKey,
      hashValue(createConnectionLoginApiKey(code, verificationKey))
    )
      ? { status: 'acknowledged' }
      : { status: 'invalid' }
  }

  if (login.state.status !== 'approved') {
    return { status: 'invalid' }
  }
  if (!hashValueMatches(plainApiKey, login.state.apiKeyHash)) {
    return { status: 'invalid' }
  }

  const now = new Date()
  const { apiKeyHash: _apiKeyHash, ...approvedState } = login.state
  const storedKey = getStoredApiKey(plainApiKey)
  const delivered = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(verification)
      .set({
        value: JSON.stringify({
          ...approvedState,
          deliveredAt: now.toISOString(),
        } satisfies ApprovedConnectionLogin),
        updatedAt: now,
      })
      .where(connectionLoginMatches(login))
      .returning({ id: verification.id })
    if (!updated) {
      return false
    }
    await tx.insert(apiKey).values({
      id: nanoid(),
      userId: approvedState.userId,
      workspaceId: null,
      name: `TradingGoose Personal API Key (local connection) ${now.toISOString()}`,
      key: storedKey,
      type: 'personal',
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
export async function approveConnectionLogin({
  approvalToken,
  code,
  userId,
}: {
  approvalToken: string
  code: string
  userId: string
}): Promise<ConnectionLoginApprovalResult> {
  const login = await readConnectionLogin(code)
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
  } satisfies ApprovedConnectionLogin

  if (!(await updateConnectionLoginState(login, approvedState))) {
    return { status: 'invalid' }
  }

  return {
    status: 'approved',
    expiresAt: login.expiresAt.toISOString(),
  }
}

export async function cancelConnectionLogin({
  approvalToken,
  code,
  userId,
}: {
  approvalToken: string
  code: string
  userId: string
}) {
  const login = await readConnectionLogin(code)
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
    .where(connectionLoginMatches(login))
    .returning({ id: verification.id })

  if (!updated) {
    return { status: 'invalid' }
  }

  return { status: 'cancelled' }
}
