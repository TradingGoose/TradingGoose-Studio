import { createHash, randomBytes } from 'crypto'
import { db } from '@tradinggoose/db'
import { apiKey, verification } from '@tradinggoose/db/schema'
import { and, eq, like, lte } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { createApiKeyMaterial, decryptApiKey } from '@/lib/api-key/service'

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
  apiKeyId: string
  encryptedApiKey: string
  deliveredAt?: string
}

type DeviceLoginState = PendingDeviceLogin | ApprovedDeviceLogin
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

export type McpDeviceLoginApprovalStatus =
  | { status: 'pending'; expiresAt: string }
  | { status: 'approved'; expiresAt: string }
  | { status: 'expired' }

export type McpDeviceLoginStartResult = {
  code: string
  verificationKey: string
  expiresAt: string
  intervalSeconds: number
}

function getDeviceLoginIdentifier(code: string) {
  return `${DEVICE_LOGIN_PREFIX}${hashValue(code)}`
}

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
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
      typeof parsed.apiKeyId === 'string' &&
      typeof parsed.encryptedApiKey === 'string' &&
      (parsed.deliveredAt === undefined || typeof parsed.deliveredAt === 'string')
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
  const code = randomBytes(32).toString('base64url')
  const verificationKey = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_LOGIN_TTL_MS)

  await db
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${DEVICE_LOGIN_PREFIX}%`),
        lte(verification.expiresAt, now)
      )
    )

  await db.insert(verification).values({
    id: nanoid(),
    identifier: getDeviceLoginIdentifier(code),
    value: JSON.stringify({
      status: 'pending',
      createdAt: now.toISOString(),
      verificationKeyHash: hashValue(verificationKey),
    } satisfies PendingDeviceLogin),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  })

  return {
    code,
    verificationKey,
    expiresAt: expiresAt.toISOString(),
    intervalSeconds: POLL_INTERVAL_SECONDS,
  }
}

export async function readMcpDeviceLoginApprovalStatus(
  code: string
): Promise<McpDeviceLoginApprovalStatus> {
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

  return {
    status: 'pending',
    expiresAt: login.expiresAt.toISOString(),
  }
}

export async function pollMcpDeviceLogin(
  code: string,
  verificationKey: string
): Promise<McpDeviceLoginPollResult> {
  while (true) {
    const login = await readDeviceLogin(code)
    if (!login) {
      return { status: 'expired' }
    }

    if (login.state.verificationKeyHash !== hashValue(verificationKey)) {
      return { status: 'invalid' }
    }

    if (login.state.status !== 'approved') {
      return {
        status: 'pending',
        intervalSeconds: POLL_INTERVAL_SECONDS,
        expiresAt: login.expiresAt.toISOString(),
      }
    }

    const approvedState = login.state
    if (approvedState.deliveredAt) {
      const [existingKey] = await db
        .select({ id: apiKey.id })
        .from(apiKey)
        .where(eq(apiKey.id, approvedState.apiKeyId))
        .limit(1)
      if (!existingKey) {
        return { status: 'expired' }
      }
      const { decrypted } = await decryptApiKey(approvedState.encryptedApiKey)
      return { status: 'approved', apiKey: decrypted, expiresAt: login.expiresAt.toISOString() }
    }

    const now = new Date()
    const deliveredState = { ...approvedState, deliveredAt: now.toISOString() }
    const delivered = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(verification)
        .set({ value: JSON.stringify(deliveredState), updatedAt: now })
        .where(deviceLoginMatches(login))
        .returning({ id: verification.id })
      if (!updated) {
        return false
      }
      await tx.insert(apiKey).values({
        id: approvedState.apiKeyId,
        userId: approvedState.userId,
        workspaceId: null,
        name: `TradingGoose MCP Access ${now.toISOString()}`,
        key: approvedState.encryptedApiKey,
        type: 'personal',
        createdAt: now,
        updatedAt: now,
      })
      return true
    })
    if (!delivered) {
      continue
    }

    const { decrypted } = await decryptApiKey(approvedState.encryptedApiKey)
    return { status: 'approved', apiKey: decrypted, expiresAt: login.expiresAt.toISOString() }
  }
}

export async function approveMcpDeviceLogin({
  code,
  userId,
}: {
  code: string
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

  const now = new Date()
  const approvedAt = now.toISOString()
  const apiKeyId = nanoid()
  const { encryptedKey } = await createApiKeyMaterial(true)
  if (!encryptedKey) {
    throw new Error('Failed to create MCP personal API key')
  }
  const approvedState = {
    status: 'approved',
    createdAt: login.state.createdAt,
    verificationKeyHash: login.state.verificationKeyHash,
    approvedAt,
    userId,
    apiKeyId,
    encryptedApiKey: encryptedKey,
  } satisfies ApprovedDeviceLogin

  if (!(await updateDeviceLoginState(login, approvedState))) {
    return { status: 'invalid' }
  }

  return {
    status: 'approved',
    expiresAt: login.expiresAt.toISOString(),
  }
}

export async function cancelMcpDeviceLogin({ code }: { code: string }) {
  const login = await readDeviceLogin(code)
  if (!login) {
    return { status: 'expired' }
  }

  if (login.state.status !== 'pending') {
    return { status: 'invalid' }
  }

  const [deleted] = await db
    .delete(verification)
    .where(deviceLoginMatches(login))
    .returning({ id: verification.id })

  if (!deleted) {
    return { status: 'invalid' }
  }

  return { status: 'cancelled' }
}
