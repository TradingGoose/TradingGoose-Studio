import { type JWTPayload, jwtVerify, SignJWT } from 'jose'
import type { CopilotWorkerIdentity } from '@/lib/copilot/agent/worker-contract'

const getJwtSecret = () => {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret || secret.length < 32)
    throw new Error('INTERNAL_API_SECRET must contain at least 32 characters')
  return new TextEncoder().encode(secret)
}

async function signPayload(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setIssuer('tradinggoose-internal')
    .setAudience('tradinggoose-api')
    .sign(getJwtSecret())
}

async function verifyPayload(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: 'tradinggoose-internal',
      audience: 'tradinggoose-api',
    })
    return payload
  } catch {
    return undefined
  }
}

export type InternalWorkflowExecutionContext = {
  source: 'workflow_block'
  parentWorkflowId?: string
  parentExecutionId?: string
  parentPendingExecutionId?: string
  parentBlockId: string
  settlesModelUsage?: true
}

type GenerateInternalTokenOptions = {
  workflowExecution?: InternalWorkflowExecutionContext
}

function isInternalWorkflowExecutionContext(
  value: unknown
): value is InternalWorkflowExecutionContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).source === 'workflow_block' &&
    typeof (value as Record<string, unknown>).parentBlockId === 'string' &&
    ((value as Record<string, unknown>).parentBlockId as string).length > 0 &&
    ((value as Record<string, unknown>).settlesModelUsage === undefined ||
      (value as Record<string, unknown>).settlesModelUsage === true)
  )
}

/**
 * Generate an internal JWT token for server-side API calls
 * Token expires in 5 minutes to keep it short-lived
 * @param userId Optional user ID to embed in the token payload
 */
export async function generateInternalToken(
  userId?: string,
  options: GenerateInternalTokenOptions = {}
): Promise<string> {
  const payload: {
    type: 'internal'
    userId?: string
    workflowExecution?: InternalWorkflowExecutionContext
  } = { type: 'internal' }

  if (userId) {
    payload.userId = userId
  }
  if (options.workflowExecution) {
    payload.workflowExecution = options.workflowExecution
  }

  return signPayload(payload)
}

/**
 * Structured verification result for internal JWTs.
 */
export interface InternalTokenVerificationResult {
  valid: boolean
  userId?: string
  workflowExecution?: InternalWorkflowExecutionContext
}

/**
 * Verify an internal JWT token and return structured metadata.
 */
export async function verifyInternalTokenDetailed(
  token: string
): Promise<InternalTokenVerificationResult> {
  const payload = await verifyPayload(token)
  if (payload?.type !== 'internal') return { valid: false }
  return {
    valid: true,
    userId: typeof payload.userId === 'string' ? payload.userId : undefined,
    workflowExecution: isInternalWorkflowExecutionContext(payload.workflowExecution)
      ? payload.workflowExecution
      : undefined,
  }
}

export function generateCopilotWorkerToken(context: CopilotWorkerIdentity): Promise<string> {
  return signPayload({ type: 'copilot-worker', ...context })
}

export async function verifyCopilotWorkerToken(
  token: string
): Promise<CopilotWorkerIdentity | undefined> {
  const payload = await verifyPayload(token)
  if (
    payload?.type !== 'copilot-worker' ||
    !['actorUserId', 'jobId', 'threadId', 'runId'].every(
      (key) => typeof payload[key] === 'string' && payload[key].length > 0
    ) ||
    !(payload.workspaceId === null || typeof payload.workspaceId === 'string')
  )
    return
  return {
    actorUserId: payload.actorUserId as string,
    workspaceId: payload.workspaceId as string | null,
    jobId: payload.jobId as string,
    threadId: payload.threadId as string,
    runId: payload.runId as string,
    ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
  }
}
