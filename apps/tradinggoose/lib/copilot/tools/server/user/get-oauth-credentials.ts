import { db } from '@tradinggoose/db'
import { account, user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { createPermissionError } from '@/lib/copilot/review-sessions/permissions'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  resolveServerWorkflowScope,
} from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'

interface GetOAuthCredentialsParams {
  workflowId?: string
}

export const getOAuthCredentialsServerTool: BaseServerTool<GetOAuthCredentialsParams, any> = {
  name: 'get_oauth_credentials',
  async execute(
    params: GetOAuthCredentialsParams,
    context?: ServerToolExecutionContext
  ): Promise<any> {
    const logger = createLogger('GetOAuthCredentialsServerTool')

    if (!context?.userId) {
      logger.error(
        'Unauthorized attempt to access OAuth credentials - no authenticated user context'
      )
      throw new Error('Authentication required')
    }

    const authenticatedUserId = context.userId

    const workflowScope = await resolveServerWorkflowScope(params, context)
    if (workflowScope && !workflowScope.hasAccess) {
      const errorMessage = createPermissionError('access credentials in')
      logger.error('Unauthorized attempt to access OAuth credentials', {
        workflowId: workflowScope.workflowId,
        authenticatedUserId,
      })
      throw new Error(errorMessage)
    }

    const userId = authenticatedUserId

    logger.info('Fetching OAuth credentials for authenticated user', {
      userId,
      workflowId: workflowScope?.workflowId,
    })
    const accounts = await db.select().from(account).where(eq(account.userId, userId))
    const userRecord = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    const userEmail = userRecord.length > 0 ? userRecord[0]?.email : null

    const credentials: Array<{
      id: string
      name: string
      provider: string
      lastUsed: string
      isDefault: boolean
      accessToken: string | null
    }> = []
    const requestId = generateRequestId()
    for (const acc of accounts) {
      const providerId = acc.providerId
      const [baseProvider, featureType = 'default'] = providerId.split('-')
      let displayName = ''
      if (acc.idToken) {
        try {
          const decoded = jwtDecode<{ email?: string; name?: string }>(acc.idToken)
          displayName = decoded.email || decoded.name || ''
        } catch {}
      }
      if (!displayName && baseProvider === 'github') displayName = `${acc.accountId} (GitHub)`
      if (!displayName && userEmail) displayName = userEmail
      if (!displayName) displayName = `${acc.accountId} (${baseProvider})`
      let accessToken: string | null = acc.accessToken ?? null
      try {
        const { accessToken: refreshedToken } = await refreshTokenIfNeeded(
          requestId,
          acc as any,
          acc.id
        )
        accessToken = refreshedToken || accessToken
      } catch {}
      credentials.push({
        id: acc.id,
        name: displayName,
        provider: providerId,
        lastUsed: acc.updatedAt.toISOString(),
        isDefault: featureType === 'default',
        accessToken,
      })
    }
    logger.info('Fetched OAuth credentials', { userId, count: credentials.length })
    return { credentials, total: credentials.length }
  },
}
