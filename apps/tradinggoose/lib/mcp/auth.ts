import { createHash, randomBytes } from 'crypto'
import { db } from '@tradinggoose/db'
import { apiKey, verification } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { authenticateApiKey } from '@/lib/api-key/auth'
import { decryptApiKey, encryptApiKey } from '@/lib/api-key/service'

const DEVICE_LOGIN_TTL_MS = 10 * 60 * 1000
const DEVICE_LOGIN_PREFIX = 'mcp:'
const MCP_API_KEY_PREFIX = 'sk-tradinggoose-mcp.'
const POLL_INTERVAL_SECONDS = 2

type PendingDeviceLogin = {
  status: 'pending'
  createdAt: string
  verificationKeyHash: string
  approvalToken?: string
  approvalUserId?: string
}

type ApprovedDeviceLogin = {
  status: 'approved'
  createdAt: string
  verificationKeyHash: string
  approvedAt: string
  userId: string
  keyId?: string
  apiKeyHash?: string
  apiKeyEncrypted?: string
}

type IssuedDeviceLogin = ApprovedDeviceLogin & {
  keyId: string
  apiKeyHash: string
  apiKeyEncrypted: string
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
  | { status: 'confirmed'; expiresAt: string }
  | { status: 'invalid' }
  | { status: 'expired' }

export type McpDeviceLoginApprovalResult =
  | { status: 'approved'; expiresAt: string }
  | { status: 'expired' }
  | { status: 'invalid' }

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

function createMcpApiKey(keyId: string) {
  return `${MCP_API_KEY_PREFIX}${keyId}.${randomBytes(32).toString('base64url')}`
}

function readMcpApiKeyId(value: string) {
  const match = value.match(/^sk-tradinggoose-mcp\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/)
  return match?.[1] ?? null
}

function isIssuedDeviceLogin(state: DeviceLoginState): state is IssuedDeviceLogin {
  return (
    state.status === 'approved' &&
    typeof state.keyId === 'string' &&
    typeof state.apiKeyHash === 'string' &&
    typeof state.apiKeyEncrypted === 'string'
  )
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
      (parsed.approvalToken === undefined || typeof parsed.approvalToken === 'string') &&
      (parsed.approvalUserId === undefined || typeof parsed.approvalUserId === 'string')
    ) {
      return parsed as PendingDeviceLogin
    }
    const approvedHasNoKey =
      parsed.keyId === undefined &&
      parsed.apiKeyHash === undefined &&
      parsed.apiKeyEncrypted === undefined
    const approvedHasIssuedKey =
      typeof parsed.keyId === 'string' &&
      typeof parsed.apiKeyHash === 'string' &&
      typeof parsed.apiKeyEncrypted === 'string'
    if (
      parsed.status === 'approved' &&
      typeof parsed.createdAt === 'string' &&
      typeof parsed.verificationKeyHash === 'string' &&
      typeof parsed.approvedAt === 'string' &&
      typeof parsed.userId === 'string' &&
      (approvedHasNoKey || approvedHasIssuedKey)
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

async function issueMcpDeviceLoginKey(
  login: DeviceLogin,
  approvedState: ApprovedDeviceLogin
): Promise<McpDeviceLoginPollResult | null> {
  const keyId = nanoid()
  const plainKey = createMcpApiKey(keyId)
  const encryptedKey = (await encryptApiKey(plainKey)).encrypted

  const nextState = {
    ...approvedState,
    keyId,
    apiKeyHash: hashValue(plainKey),
    apiKeyEncrypted: encryptedKey,
  } satisfies IssuedDeviceLogin

  return (await updateDeviceLoginState(login, nextState))
    ? { status: 'approved', apiKey: plainKey, expiresAt: login.expiresAt.toISOString() }
    : null
}

async function confirmMcpDeviceLoginKey(
  login: DeviceLogin,
  issuedState: IssuedDeviceLogin,
  plainKey: string
): Promise<boolean> {
  if (issuedState.apiKeyHash !== hashValue(plainKey)) {
    return false
  }

  const now = new Date()
  const confirmed = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(verification)
      .where(deviceLoginMatches(login, issuedState))
      .returning({ id: verification.id })

    if (!deleted) {
      return null
    }

    const [createdKey] = await tx
      .insert(apiKey)
      .values({
        id: issuedState.keyId,
        userId: issuedState.userId,
        workspaceId: null,
        name: `TradingGoose MCP ${now.toISOString()}`,
        key: issuedState.apiKeyEncrypted,
        type: 'personal',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: apiKey.id })

    return createdKey
  })

  return Boolean(confirmed)
}

export async function startMcpDeviceLogin(): Promise<McpDeviceLoginStartResult> {
  const code = randomBytes(32).toString('base64url')
  const verificationKey = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEVICE_LOGIN_TTL_MS)

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

export async function createMcpDeviceLoginApprovalChallenge(code: string, userId: string) {
  while (true) {
    const login = await readDeviceLogin(code)
    if (!login) {
      return { status: 'expired' }
    }

    if (login.state.status !== 'pending') {
      return {
        status: 'approved',
        expiresAt: login.expiresAt.toISOString(),
      }
    }

    if (login.state.approvalUserId === userId && login.state.approvalToken) {
      return {
        status: 'pending',
        approvalToken: login.state.approvalToken,
        expiresAt: login.expiresAt.toISOString(),
      }
    }

    const approvalToken = randomBytes(32).toString('base64url')
    const nextState = {
      ...login.state,
      approvalToken,
      approvalUserId: userId,
    } satisfies PendingDeviceLogin

    if (await updateDeviceLoginState(login, nextState)) {
      return {
        status: 'pending',
        approvalToken,
        expiresAt: login.expiresAt.toISOString(),
      }
    }
  }
}

export async function pollMcpDeviceLogin(
  code: string,
  verificationKey: string,
  options: { confirm?: boolean; apiKey?: string } = {}
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

    if (options.confirm) {
      if (!isIssuedDeviceLogin(approvedState) || !options.apiKey) {
        return { status: 'invalid' }
      }

      if (!(await confirmMcpDeviceLoginKey(login, approvedState, options.apiKey))) {
        return { status: 'invalid' }
      }

      return {
        status: 'confirmed',
        expiresAt: login.expiresAt.toISOString(),
      }
    }

    if (isIssuedDeviceLogin(approvedState)) {
      return {
        status: 'approved',
        apiKey: (await decryptApiKey(approvedState.apiKeyEncrypted)).decrypted,
        expiresAt: login.expiresAt.toISOString(),
      }
    }

    const issued = await issueMcpDeviceLoginKey(login, approvedState)
    if (!issued) {
      continue
    }

    return issued
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

  if (login.state.approvalToken !== approvalToken || login.state.approvalUserId !== userId) {
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

  if (login.state.status !== 'pending') {
    return { status: 'invalid' }
  }

  if (login.state.approvalToken !== approvalToken || login.state.approvalUserId !== userId) {
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

export async function authenticateMcpApiKey(token: string) {
  const keyId = readMcpApiKeyId(token)
  if (!keyId) {
    return { success: false as const }
  }

  const [storedKey] = await db
    .select({
      id: apiKey.id,
      userId: apiKey.userId,
      key: apiKey.key,
      expiresAt: apiKey.expiresAt,
    })
    .from(apiKey)
    .where(and(eq(apiKey.id, keyId), eq(apiKey.type, 'personal')))
    .limit(1)

  if (!storedKey || (storedKey.expiresAt && storedKey.expiresAt < new Date())) {
    return { success: false as const }
  }

  const success = storedKey.key === token || (await authenticateApiKey(token, storedKey.key))
  return success
    ? { success: true as const, userId: storedKey.userId, keyId: storedKey.id }
    : { success: false as const }
}
