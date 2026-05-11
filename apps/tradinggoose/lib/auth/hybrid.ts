import type { NextRequest } from 'next/server'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import {
  type InternalTokenVerificationResult,
  type InternalWorkflowExecutionContext,
  verifyInternalTokenDetailed,
} from '@/lib/auth/internal'
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
  internalWorkflowExecution?: InternalWorkflowExecutionContext
  error?: string
}

function resolveInternalAuthResult(
  verification: InternalTokenVerificationResult,
  options: { requireWorkflowId?: boolean } = {}
): AuthResult {
  const userId = verification.userId
  const internalWorkflowExecution = verification.workflowExecution

  if (userId) {
    return {
      success: true,
      userId,
      authType: AuthType.INTERNAL_JWT,
      internalWorkflowExecution,
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
    internalWorkflowExecution,
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

    return resolveInternalAuthResult(verification, options)
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
        return resolveInternalAuthResult(verification, options)
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
 * Internal JWT calls resolve the authenticated user from the token userId.
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
        return resolveInternalAuthResult(verification, options)
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
