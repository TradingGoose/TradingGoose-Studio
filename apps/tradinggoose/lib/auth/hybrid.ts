import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { verifyInternalTokenDetailed } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('HybridAuth')

export const AuthType = {
  SESSION: 'session',
  API_KEY: 'api_key',
  INTERNAL_JWT: 'internal_jwt',
} as const

export function hasExternalApiCredentials(headers: Headers): boolean {
  const authHeader = headers.get('authorization')
  return headers.has('x-api-key') || authHeader?.startsWith('Bearer ') === true
}

export interface AuthResult {
  success: boolean
  userId?: string
  workspaceId?: string
  userName?: string | null
  userEmail?: string | null
  authType?: (typeof AuthType)[keyof typeof AuthType]
  apiKeyType?: 'personal' | 'workspace'
  error?: string
}

function resolveInternalAuthResult(
  userId: string | undefined,
  options: { requireWorkflowId?: boolean } = {}
): AuthResult {
  if (userId) {
    return {
      success: true,
      userId,
      authType: AuthType.INTERNAL_JWT,
    }
  }

  if (options.requireWorkflowId !== false) {
    return {
      success: false,
      error: 'userId required but not present in JWT',
    }
  }

  return {
    success: true,
    authType: AuthType.INTERNAL_JWT,
  }
}

async function getWorkflowIdFromRequest(request: NextRequest): Promise<string | null> {
  const { searchParams } = new URL(request.url)
  const workflowId = searchParams.get('workflowId')
  if (workflowId) {
    return workflowId
  }

  if (request.method !== 'POST') {
    return null
  }

  try {
    const clonedRequest = request.clone()
    const bodyText = await clonedRequest.text()
    if (!bodyText) {
      return null
    }

    const body = JSON.parse(bodyText)
    return typeof body.workflowId === 'string' ? body.workflowId : null
  } catch {
    return null
  }
}

/**
 * Check for internal JWT authentication only.
 * Rejects session and API key authentication.
 */
export async function checkInternalAuth(
  request: NextRequest,
  options: { requireWorkflowId?: boolean } = {}
): Promise<AuthResult> {
  try {
    const apiKeyHeader = request.headers.get('x-api-key')
    if (apiKeyHeader) {
      return {
        success: false,
        error: 'API key access not allowed for this endpoint. Use workflow execution instead.',
      }
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return {
        success: false,
        error: 'Internal authentication required',
      }
    }

    const token = authHeader.split(' ')[1]
    const verification = await verifyInternalTokenDetailed(token)
    if (!verification.valid) {
      return {
        success: false,
        error: 'Invalid internal token',
      }
    }

    return resolveInternalAuthResult(verification.userId, options)
  } catch (error) {
    logger.error('Error in internal authentication:', error)
    return {
      success: false,
      error: 'Authentication error',
    }
  }
}

/**
 * Check for session or internal JWT authentication.
 * Rejects API keys.
 */
export async function checkSessionOrInternalAuth(
  request: NextRequest,
  options: { requireWorkflowId?: boolean } = {}
): Promise<AuthResult> {
  try {
    const apiKeyHeader = request.headers.get('x-api-key')
    if (apiKeyHeader) {
      return {
        success: false,
        error: 'API key access not allowed for this endpoint',
      }
    }

    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const verification = await verifyInternalTokenDetailed(token)
      if (verification.valid) {
        return resolveInternalAuthResult(verification.userId, options)
      }
    }

    const session = await getSession()
    if (session?.user?.id) {
      return {
        success: true,
        userId: session.user.id,
        userName: session.user.name ?? null,
        userEmail: session.user.email ?? null,
        authType: AuthType.SESSION,
      }
    }

    return {
      success: false,
      error: 'Unauthorized',
    }
  } catch (error) {
    logger.error('Error in session/internal authentication:', error)
    return {
      success: false,
      error: 'Authentication error',
    }
  }
}

/**
 * Check for authentication using any of the 3 supported methods:
 * 1. Session authentication (cookies)
 * 2. API key authentication (X-API-Key header)
 * 3. Internal JWT authentication (Authorization: Bearer header)
 *
 * For internal JWT calls, uses userId directly when present and falls back to
 * workflow lookup for older tokens that do not carry a userId claim.
 */
export async function checkHybridAuth(
  request: NextRequest,
  options: { requireWorkflowId?: boolean } = {}
): Promise<AuthResult> {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const verification = await verifyInternalTokenDetailed(token)

      if (verification.valid) {
        if (verification.userId) {
          return {
            success: true,
            userId: verification.userId,
            authType: AuthType.INTERNAL_JWT,
          }
        }

        const workflowId = await getWorkflowIdFromRequest(request)
        if (!workflowId && options.requireWorkflowId !== false) {
          return {
            success: false,
            error: 'workflowId required for internal JWT calls',
          }
        }

        if (workflowId) {
          const [workflowData] = await db
            .select({ userId: workflow.userId })
            .from(workflow)
            .where(eq(workflow.id, workflowId))
            .limit(1)

          if (!workflowData) {
            return {
              success: false,
              error: 'Workflow not found',
            }
          }

          return {
            success: true,
            userId: workflowData.userId,
            authType: AuthType.INTERNAL_JWT,
          }
        }

        return {
          success: true,
          authType: AuthType.INTERNAL_JWT,
        }
      }
    }

    const session = await getSession()
    if (session?.user?.id) {
      return {
        success: true,
        userId: session.user.id,
        userName: session.user.name ?? null,
        userEmail: session.user.email ?? null,
        authType: AuthType.SESSION,
      }
    }

    const apiKeyHeader = request.headers.get('x-api-key')
    if (apiKeyHeader) {
      const result = await authenticateApiKeyFromHeader(apiKeyHeader)
      if (result.success) {
        await updateApiKeyLastUsed(result.keyId!)
        return {
          success: true,
          userId: result.userId!,
          workspaceId: result.workspaceId,
          authType: AuthType.API_KEY,
          apiKeyType: result.keyType,
        }
      }

      return {
        success: false,
        error: 'Invalid API key',
      }
    }

    return {
      success: false,
      error: 'Unauthorized',
    }
  } catch (error) {
    logger.error('Error in hybrid authentication:', error)
    return {
      success: false,
      error: 'Authentication error',
    }
  }
}
