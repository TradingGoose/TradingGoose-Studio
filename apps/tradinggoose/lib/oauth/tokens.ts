import { db } from '@tradinggoose/db'
import { account, workflow } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getMicrosoftRefreshTokenExpiry,
  isMicrosoftProvider,
  PROACTIVE_REFRESH_THRESHOLD_DAYS,
} from '@/lib/oauth/oauth'
import { refreshOAuthToken } from '@/lib/oauth/oauth.server'

const logger = createLogger('OAuthTokens')

function getValidAccessToken(tokenAccount: any): string | null {
  if (!tokenAccount?.accessToken) {
    return null
  }

  if (tokenAccount.accessTokenExpiresAt && tokenAccount.accessTokenExpiresAt <= new Date()) {
    return null
  }

  return tokenAccount.accessToken
}

function getRefreshState(tokenAccount: any) {
  const now = new Date()
  const hasValidAccessToken = !!getValidAccessToken(tokenAccount)
  const accessTokenNeedsRefresh = !!tokenAccount.refreshToken && !hasValidAccessToken
  const proactiveRefreshThreshold = new Date(
    now.getTime() + PROACTIVE_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  )
  const refreshTokenNeedsProactiveRefresh =
    !!tokenAccount.refreshToken &&
    isMicrosoftProvider(tokenAccount.providerId) &&
    tokenAccount.refreshTokenExpiresAt &&
    tokenAccount.refreshTokenExpiresAt <= proactiveRefreshThreshold

  return {
    refreshTokenNeedsProactiveRefresh,
    shouldRefresh: accessTokenNeedsRefresh || refreshTokenNeedsProactiveRefresh,
  }
}

async function refreshTokenAccount(
  requestId: string,
  tokenAccountId: string,
  ownerUserId: string,
  expectedProviderId?: string
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [tokenAccount] = await tx
      .select()
      .from(account)
      .where(and(eq(account.id, tokenAccountId), eq(account.userId, ownerUserId)))
      .for('update')
      .limit(1)

    if (!tokenAccount || (expectedProviderId && tokenAccount.providerId !== expectedProviderId)) {
      return null
    }

    const refreshState = getRefreshState(tokenAccount)
    const accessToken = getValidAccessToken(tokenAccount)
    if (!refreshState.shouldRefresh) {
      return accessToken
    }

    try {
      const refreshedToken = await refreshOAuthToken(
        tokenAccount.providerId,
        tokenAccount.refreshToken!
      )
      if (!refreshedToken) {
        throw new Error('Failed to refresh token')
      }

      await tx
        .update(account)
        .set({
          accessToken: refreshedToken.accessToken,
          accessTokenExpiresAt: new Date(Date.now() + refreshedToken.expiresIn * 1000),
          ...(refreshedToken.refreshToken !== tokenAccount.refreshToken
            ? { refreshToken: refreshedToken.refreshToken }
            : {}),
          ...(isMicrosoftProvider(tokenAccount.providerId)
            ? { refreshTokenExpiresAt: getMicrosoftRefreshTokenExpiry() }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(account.id, tokenAccountId), eq(account.userId, ownerUserId)))

      logger.info(`[${requestId}] Successfully refreshed OAuth token account access token`)
      return refreshedToken.accessToken
    } catch (error) {
      if (refreshState.refreshTokenNeedsProactiveRefresh && accessToken) {
        logger.warn(
          `[${requestId}] Proactive refresh failed, using existing OAuth token account access token`
        )
        return accessToken
      }
      throw error
    }
  })
}

/**
 * Get the user ID based on either a session or a workflow ID
 */
export async function getUserId(
  requestId: string,
  workflowId?: string
): Promise<string | undefined> {
  // If workflowId is provided, this is a server-side request
  if (workflowId) {
    // Get the workflow to verify the user ID
    const workflows = await db
      .select({ userId: workflow.userId })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflows.length) {
      logger.warn(`[${requestId}] Workflow not found`)
      return undefined
    }

    return workflows[0].userId
  }
  // This is a client-side request, use the session
  const session = await getSession()

  // Check if the user is authenticated
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthenticated request rejected`)
    return undefined
  }

  return session.user.id
}

/**
 * Get an OAuth token-storage account row and verify it belongs to the owner.
 */
export async function getOAuthTokenAccount(
  requestId: string,
  tokenAccountId: string,
  ownerUserId: string
) {
  const tokenAccounts = await db
    .select()
    .from(account)
    .where(and(eq(account.id, tokenAccountId), eq(account.userId, ownerUserId)))
    .limit(1)

  if (!tokenAccounts.length) {
    logger.warn(`[${requestId}] OAuth token account not found`)
    return undefined
  }

  return tokenAccounts[0]
}

/**
 * Refreshes an OAuth token if needed based on the token-storage account row.
 * @param tokenAccountId The underlying OAuth account row ID to check and potentially refresh.
 * @param ownerUserId The user ID who owns the OAuth account row.
 * @param requestId Request ID for log correlation
 * @param expectedProviderId Optional OAuth service required by the caller.
 * @returns The valid access token or null if refresh fails
 */
export async function refreshAccessTokenIfNeeded(
  tokenAccountId: string,
  ownerUserId: string,
  requestId: string,
  expectedProviderId?: string
): Promise<string | null> {
  const tokenAccount = await getOAuthTokenAccount(requestId, tokenAccountId, ownerUserId)

  if (!tokenAccount || (expectedProviderId && tokenAccount.providerId !== expectedProviderId)) {
    return null
  }

  const refreshState = getRefreshState(tokenAccount)
  const accessToken = getValidAccessToken(tokenAccount)

  if (refreshState.shouldRefresh) {
    logger.info(`[${requestId}] Refreshing OAuth token account`)
    try {
      return await refreshTokenAccount(requestId, tokenAccountId, ownerUserId, expectedProviderId)
    } catch (error) {
      logger.error(`[${requestId}] Error refreshing OAuth token account`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        providerId: tokenAccount.providerId,
        tokenAccountId,
        userId: tokenAccount.userId,
      })
      return null
    }
  } else if (!accessToken) {
    // We have no access token and either no refresh token or not eligible to refresh
    logger.error(`[${requestId}] Missing access token for OAuth token account`)
    return null
  }

  logger.info(`[${requestId}] OAuth token account access token is valid`)
  return accessToken
}
