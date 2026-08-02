import { db } from '@tradinggoose/db'
import { account, credential, webhook } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  getExternalSubscriptionCredentialIds,
  lockExternalSubscriptionCredentials,
} from '@/lib/webhooks/webhook-helpers'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthDisconnectAPI')

/**
 * Disconnect one OAuth account for the current user.
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated disconnect request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { accountId } = await request.json()

    if (typeof accountId !== 'string' || !accountId.trim()) {
      logger.warn(`[${requestId}] Missing accountId in disconnect request`)
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Processing OAuth disconnect request`, {
      accountId,
    })

    const targetAccountId = accountId.trim()
    const result = await db.transaction(async (tx) => {
      const [ownedAccount] = await tx
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, session.user.id), eq(account.id, targetAccountId)))
        .for('update')
        .limit(1)
      if (!ownedAccount) return 'missing' as const

      const credentialRows = await tx
        .select({ id: credential.id })
        .from(credential)
        .where(eq(credential.accountId, targetAccountId))
      const credentialIds = credentialRows.map((row) => row.id).sort()
      await lockExternalSubscriptionCredentials(tx, credentialIds)

      if (credentialIds.length) {
        const subscriptionOwners = await tx
          .select({ provider: webhook.provider, providerConfig: webhook.providerConfig })
          .from(webhook)
          .where(inArray(webhook.provider, ['airtable', 'microsoftteams', 'webflow']))
        const ownedCredentials = new Set(credentialIds)
        const inUse = subscriptionOwners.some((owner) =>
          getExternalSubscriptionCredentialIds(owner).some((id) => ownedCredentials.has(id))
        )
        if (inUse) return 'in_use' as const
      }

      await tx
        .delete(account)
        .where(and(eq(account.userId, session.user.id), eq(account.id, targetAccountId)))
      return 'deleted' as const
    })

    if (result === 'in_use') {
      return NextResponse.json(
        {
          error: 'Delete or reconfigure dependent webhooks before disconnecting this account.',
          code: 'EXTERNAL_SUBSCRIPTION_IN_USE',
        },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error disconnecting OAuth account`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
