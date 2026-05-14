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

async function getConcurrentRefreshAccessToken(
  requestId: string,
  tokenAccountId: string,
  userId?: string
): Promise<string | null> {
  if (!userId) {
    return null
  }

  logger.warn(
    `[${requestId}] Refresh attempt failed, checking if another concurrent request succeeded`
  )

  const freshTokenAccount = await getOAuthTokenAccount(requestId, tokenAccountId, userId)
  const concurrentAccessToken = getValidAccessToken(freshTokenAccount)

  if (!concurrentAccessToken) {
    return null
  }

  logger.info(`[${requestId}] Found valid token from concurrent refresh, using it`)
  return concurrentAccessToken
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
 * @returns The valid access token or null if refresh fails
 */
export async function refreshAccessTokenIfNeeded(
  tokenAccountId: string,
  ownerUserId: string,
  requestId: string
): Promise<string | null> {
  const tokenAccount = await getOAuthTokenAccount(requestId, tokenAccountId, ownerUserId)

  if (!tokenAccount) {
    return null
  }

  const refreshState = getRefreshState(tokenAccount)
  const accessToken = getValidAccessToken(tokenAccount)

  if (refreshState.shouldRefresh) {
    logger.info(`[${requestId}] Refreshing OAuth token account`)
    try {
      const refreshedToken = await refreshOAuthToken(
        tokenAccount.providerId,
        tokenAccount.refreshToken!
      )

      if (!refreshedToken) {
        throw new Error('Failed to refresh token')
      }

      // Prepare update data
      const updateData: any = {
        accessToken: refreshedToken.accessToken,
        accessTokenExpiresAt: new Date(Date.now() + refreshedToken.expiresIn * 1000),
        updatedAt: new Date(),
      }

      // If we received a new refresh token, update it
      if (
        refreshedToken.refreshToken &&
        refreshedToken.refreshToken !== tokenAccount.refreshToken
      ) {
        logger.info(`[${requestId}] Updating OAuth token account refresh token`)
        updateData.refreshToken = refreshedToken.refreshToken
      }

      if (isMicrosoftProvider(tokenAccount.providerId)) {
        updateData.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
      }

      // Update the token in the database
      await db.update(account).set(updateData).where(eq(account.id, tokenAccountId))

      logger.info(`[${requestId}] Successfully refreshed OAuth token account access token`)
      return refreshedToken.accessToken
    } catch (error) {
      if (refreshState.refreshTokenNeedsProactiveRefresh && accessToken) {
        logger.warn(
          `[${requestId}] Proactive refresh failed, using existing OAuth token account access token`
        )
        return accessToken
      }

      const concurrentAccessToken = await getConcurrentRefreshAccessToken(
        requestId,
        tokenAccountId,
        tokenAccount.userId
      )
      if (concurrentAccessToken) {
        return concurrentAccessToken
      }

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

/**
 * Enhanced version that returns additional information about the refresh operation
 */
export async function refreshTokenIfNeeded(
  requestId: string,
  tokenAccount: any,
  tokenAccountId: string
): Promise<{ accessToken: string; refreshed: boolean }> {
  const refreshState = getRefreshState(tokenAccount)
  const accessToken = getValidAccessToken(tokenAccount)

  // If token appears valid and present, return it directly
  if (!refreshState.shouldRefresh) {
    if (!accessToken) {
      throw new Error('OAuth credential has no valid access token')
    }
    logger.info(`[${requestId}] Access token is valid`)
    return { accessToken, refreshed: false }
  }

  try {
    const refreshResult = await refreshOAuthToken(
      tokenAccount.providerId,
      tokenAccount.refreshToken!
    )

    if (!refreshResult) {
      logger.error(`[${requestId}] Failed to refresh OAuth token account`)
      throw new Error('Failed to refresh token')
    }

    const { accessToken: refreshedToken, expiresIn, refreshToken: newRefreshToken } = refreshResult

    // Prepare update data
    const updateData: any = {
      accessToken: refreshedToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Use provider's expiry
      updatedAt: new Date(),
    }

    // If we received a new refresh token, update it
    if (newRefreshToken && newRefreshToken !== tokenAccount.refreshToken) {
      logger.info(`[${requestId}] Updating refresh token`)
      updateData.refreshToken = newRefreshToken
    }

    if (isMicrosoftProvider(tokenAccount.providerId)) {
      updateData.refreshTokenExpiresAt = getMicrosoftRefreshTokenExpiry()
    }

    await db.update(account).set(updateData).where(eq(account.id, tokenAccountId))

    logger.info(`[${requestId}] Successfully refreshed access token`)
    return { accessToken: refreshedToken, refreshed: true }
  } catch (error) {
    const accessToken = getValidAccessToken(tokenAccount)
    if (refreshState.refreshTokenNeedsProactiveRefresh && accessToken) {
      logger.warn(`[${requestId}] Proactive refresh failed, using existing access token`)
      return { accessToken, refreshed: false }
    }

    const concurrentAccessToken = await getConcurrentRefreshAccessToken(
      requestId,
      tokenAccountId,
      tokenAccount.userId
    )
    if (concurrentAccessToken) {
      return { accessToken: concurrentAccessToken, refreshed: true }
    }

    logger.error(`[${requestId}] Refresh failed and no valid token found in DB`, error)
    throw error
  }
}
