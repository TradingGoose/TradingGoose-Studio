import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { apiKey, verification } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createApiKeyMaterial } from '@/lib/api-key/service'
import { env } from '@/lib/env'

const DEVICE_LOGIN_TTL_MS = 10 * 60 * 1000
const DEVICE_LOGIN_PREFIX = 'mcp:'
const POLL_INTERVAL_SECONDS = 2

type PendingDeviceLogin = {
  status: 'pending'
  createdAt: string
  verificationKeyHash: string
  approvalUserId?: string
  approvalTokenHash?: string
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

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function signDeviceLoginCode(unsignedCode: string): string {
  return createHmac('sha256', env.INTERNAL_API_SECRET).update(unsignedCode).digest('base64url')
}

function buildDeviceLoginId(code: string): string {
  return `${DEVICE_LOGIN_PREFIX}${hashValue(code)}`
}

function createDeviceLoginCode({
  expiresAt,
  now,
  verificationKey,
}: {
  expiresAt: Date
  now: Date
  verificationKey: string
}): string {
  const unsignedCode = [
    randomBytes(32).toString('base64url'),
    String(now.getTime()),
    String(expiresAt.getTime()),
    hashValue(verificationKey),
  ].join('.')
  return `${unsignedCode}.${signDeviceLoginCode(unsignedCode)}`
}

function readDeviceLoginCode(code: string): {
  state: PendingDeviceLogin
  expiresAt: Date
  id: string
} | null {
  try {
    const [nonce, issuedAtRaw, expiresAtRaw, verificationKeyHash, encodedSignature, extra] =
      code.split('.')
    if (
      !nonce ||
      !issuedAtRaw ||
      !expiresAtRaw ||
      !verificationKeyHash ||
      !encodedSignature ||
      extra
    ) {
      return null
    }

    const unsignedCode = `${nonce}.${issuedAtRaw}.${expiresAtRaw}.${verificationKeyHash}`
    const expectedSignature = signDeviceLoginCode(unsignedCode)
    const signatureMatches =
      expectedSignature.length === encodedSignature.length &&
      timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(encodedSignature))

    if (!signatureMatches) {
      return null
    }

    const issuedAt = Number(issuedAtRaw)
    const expiresAt = Number(expiresAtRaw)
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
      return null
    }

    if (expiresAt <= Date.now()) {
      return null
    }

    return {
      expiresAt: new Date(expiresAt),
      id: buildDeviceLoginId(code),
      state: {
        status: 'pending',
        createdAt: new Date(issuedAt).toISOString(),
        verificationKeyHash,
      },
    }
  } catch {
    return null
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
      typeof parsed.verificationKeyHash === 'string' &&
      (parsed.approvalUserId === undefined || typeof parsed.approvalUserId === 'string') &&
      (parsed.approvalTokenHash === undefined || typeof parsed.approvalTokenHash === 'string')
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
  const [row] = await db
    .select({
      id: verification.id,
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(eq(verification.id, buildDeviceLoginId(code)))
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

export async function startMcpDeviceLogin(): Promise<McpDeviceLoginStartResult> {
  const verificationKey = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_LOGIN_TTL_MS)

  return {
    code: createDeviceLoginCode({ expiresAt, now, verificationKey }),
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
  let login = await readDeviceLogin(code)
  if (!login) {
    const codeState = readDeviceLoginCode(code)
    if (!codeState) {
      return { status: 'expired' }
    }

    const approvalToken = randomBytes(32).toString('base64url')
    const state = {
      ...codeState.state,
      approvalUserId: userId,
      approvalTokenHash: hashValue(approvalToken),
    } satisfies PendingDeviceLogin
    const [inserted] = await db
      .insert(verification)
      .values({
        id: codeState.id,
        identifier: codeState.id,
        value: JSON.stringify(state),
        expiresAt: codeState.expiresAt,
        createdAt: new Date(codeState.state.createdAt),
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: verification.id })
      .returning({ id: verification.id })

    if (inserted) {
      return {
        status: 'pending',
        expiresAt: codeState.expiresAt.toISOString(),
        approvalToken,
      }
    }

    login = await readDeviceLogin(code)
    if (!login) {
      return { status: 'expired' }
    }
  }

  if (login.state.status === 'approved') {
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

  const approvalToken = randomBytes(32).toString('base64url')
  const challengedState = {
    ...login.state,
    approvalUserId: userId,
    approvalTokenHash: hashValue(approvalToken),
  } satisfies PendingDeviceLogin

  if (!(await updateDeviceLoginState(login, challengedState))) {
    return { status: 'invalid' }
  }

  return {
    status: 'pending',
    expiresAt: login.expiresAt.toISOString(),
    approvalToken,
  }
}

export async function pollMcpDeviceLogin(
  code: string,
  verificationKey: string
): Promise<McpDeviceLoginPollResult> {
  const login = await readDeviceLogin(code)
  if (!login) {
    const codeState = readDeviceLoginCode(code)
    if (!codeState) {
      return { status: 'expired' }
    }
    if (codeState.state.verificationKeyHash !== hashValue(verificationKey)) {
      return { status: 'invalid' }
    }
    return {
      status: 'pending',
      intervalSeconds: POLL_INTERVAL_SECONDS,
      expiresAt: codeState.expiresAt.toISOString(),
    }
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
  const { key, storedKey } = await createApiKeyMaterial()
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
      key: storedKey,
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
    if (login.state.deliveredAt) {
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

  if (
    login.state.approvalUserId !== userId ||
    login.state.approvalTokenHash !== hashValue(approvalToken)
  ) {
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

  if (
    login.state.approvalUserId !== userId ||
    login.state.approvalTokenHash !== hashValue(approvalToken)
  ) {
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
