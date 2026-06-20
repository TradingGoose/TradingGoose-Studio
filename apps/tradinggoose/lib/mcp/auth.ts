import { createHash, randomBytes } from 'crypto'
import { db } from '@tradinggoose/db'
import { apiKey, verification } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { authenticateApiKeyFromHeader, createPersonalApiKey } from '@/lib/api-key/service'

const DEVICE_LOGIN_TTL_MS = 10 * 60 * 1000
const DEVICE_LOGIN_PREFIX = 'mcp:'
const POLL_INTERVAL_SECONDS = 2

type PendingDeviceLogin = {
  status: 'pending'
  createdAt: string
  userApprovalTokenHash?: string
}

type ApprovedDeviceLogin = {
  status: 'approved'
  createdAt: string
  approvedAt: string
  userId: string
  keyId: string
  apiKey: string
}

type DeviceLoginState = PendingDeviceLogin | ApprovedDeviceLogin

export type McpDeviceLoginPollResult =
  | { status: 'pending'; intervalSeconds: number; expiresAt: string }
  | { status: 'approved'; apiKey: string; expiresAt: string }
  | { status: 'expired' }

export type McpDeviceLoginApprovalResult =
  | { status: 'approved'; expiresAt: string }
  | { status: 'expired' }
  | { status: 'invalid' }

export type McpDeviceLoginStartResult = {
  code: string
  expiresAt: string
  intervalSeconds: number
}

export type McpApiKeyRevocationResult = {
  revoked: boolean
}

function getDeviceLoginIdentifier(code: string) {
  const digest = createHash('sha256').update(code).digest('hex')
  return `${DEVICE_LOGIN_PREFIX}${digest}`
}

function getUserApprovalTokenHash(code: string, approvalToken: string, userId: string) {
  return createHash('sha256').update(`${code}:${approvalToken}:${userId}`).digest('hex')
}

function parseDeviceLoginState(value: string): DeviceLoginState | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (parsed.status === 'pending' && typeof parsed.createdAt === 'string') {
      return parsed as PendingDeviceLogin
    }
    if (
      parsed.status === 'approved' &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.approvedAt === 'string' &&
      typeof parsed.userId === 'string' &&
      typeof parsed.keyId === 'string' &&
      typeof parsed.apiKey === 'string'
    ) {
      return parsed as ApprovedDeviceLogin
    }
    return null
  } catch {
    return null
  }
}

async function readDeviceLogin(code: string) {
  const identifier = getDeviceLoginIdentifier(code)
  const [row] = await db
    .select({
      id: verification.id,
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(eq(verification.identifier, identifier))
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

export async function startMcpDeviceLogin(): Promise<McpDeviceLoginStartResult> {
  const code = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_LOGIN_TTL_MS)

  await db.insert(verification).values({
    id: nanoid(),
    identifier: getDeviceLoginIdentifier(code),
    value: JSON.stringify({
      status: 'pending',
      createdAt: now.toISOString(),
    } satisfies PendingDeviceLogin),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  })

  return {
    code,
    expiresAt: expiresAt.toISOString(),
    intervalSeconds: POLL_INTERVAL_SECONDS,
  }
}

export async function createMcpDeviceLoginApprovalChallenge(code: string, userId: string) {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.status === 'approved') {
    return {
      status: 'approved',
      expiresAt: login.expiresAt.toISOString(),
    }
  }

  const now = new Date()
  const approvalToken = randomBytes(32).toString('base64url')
  await db
    .update(verification)
    .set({
      value: JSON.stringify({
        ...login.state,
        userApprovalTokenHash: getUserApprovalTokenHash(code, approvalToken, userId),
      } satisfies PendingDeviceLogin),
      updatedAt: now,
    })
    .where(eq(verification.id, login.id))

  return {
    status: 'pending',
    approvalToken,
    expiresAt: login.expiresAt.toISOString(),
  }
}

export async function pollMcpDeviceLogin(code: string): Promise<McpDeviceLoginPollResult> {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.status === 'pending') {
    return {
      status: 'pending',
      intervalSeconds: POLL_INTERVAL_SECONDS,
      expiresAt: login.expiresAt.toISOString(),
    }
  }

  await db.delete(verification).where(eq(verification.id, login.id))
  return {
    status: 'approved',
    apiKey: login.state.apiKey,
    expiresAt: login.expiresAt.toISOString(),
  }
}

export async function approveMcpDeviceLogin({
  code,
  approvalToken,
  userId,
}: {
  code: string
  approvalToken: string
  userId: string
}): Promise<McpDeviceLoginApprovalResult> {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.status === 'approved') {
    return {
      status: 'approved',
      expiresAt: login.expiresAt.toISOString(),
    }
  }

  if (login.state.userApprovalTokenHash !== getUserApprovalTokenHash(code, approvalToken, userId)) {
    return { status: 'invalid' }
  }

  const now = new Date()
  const createdKey = await createPersonalApiKey({
    userId,
    name: `TradingGoose MCP ${now.toISOString()}`,
    createdAt: now,
  })

  await db
    .update(verification)
    .set({
      value: JSON.stringify({
        status: 'approved',
        createdAt: login.state.createdAt,
        approvedAt: now.toISOString(),
        userId,
        keyId: createdKey.id,
        apiKey: createdKey.key,
      } satisfies ApprovedDeviceLogin),
      updatedAt: now,
    })
    .where(eq(verification.id, login.id))

  return {
    status: 'approved',
    expiresAt: login.expiresAt.toISOString(),
  }
}

export async function cancelMcpDeviceLogin({
  code,
  approvalToken,
  userId,
}: {
  code: string
  approvalToken: string
  userId: string
}) {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (
    login.state.status !== 'pending' ||
    login.state.userApprovalTokenHash !== getUserApprovalTokenHash(code, approvalToken, userId)
  ) {
    return { status: 'invalid' }
  }

  await db.delete(verification).where(eq(verification.id, login.id))
  return { status: 'cancelled' }
}

export async function revokeMcpApiKeyByBearerToken(
  token: string
): Promise<McpApiKeyRevocationResult> {
  const auth = await authenticateApiKeyFromHeader(token, { keyTypes: ['personal'] })
  if (!auth.success || !auth.keyId || !auth.userId) {
    return { revoked: false }
  }

  const deleted = await db
    .delete(apiKey)
    .where(
      and(eq(apiKey.id, auth.keyId), eq(apiKey.userId, auth.userId), eq(apiKey.type, 'personal'))
    )
    .returning({ id: apiKey.id })

  return { revoked: deleted.length > 0 }
}
