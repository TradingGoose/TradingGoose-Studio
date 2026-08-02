import { db } from '@tradinggoose/db'
import { webhook as webhookTable, workflow as workflowTable } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/tokens'

const logger = createLogger('TeamsSubscriptionRenewal')

/**
 * Cron endpoint to renew Microsoft Teams chat subscriptions before they expire
 *
 * Teams subscriptions expire after ~3 days and must be renewed.
 * Configured in helm/tradinggoose/values.yaml under cronjobs.jobs.renewSubscriptions
 */
export async function GET(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'Teams subscription renewal')
    if (authError) {
      return authError
    }

    logger.info('Starting Teams subscription renewal job')

    let totalRenewed = 0
    let totalFailed = 0
    let totalChecked = 0

    // Get all active Microsoft Teams webhooks with their workflows
    const webhooksWithWorkflows = await db
      .select({
        webhook: webhookTable,
        workflow: workflowTable,
      })
      .from(webhookTable)
      .innerJoin(workflowTable, eq(webhookTable.workflowId, workflowTable.id))
      .where(and(eq(webhookTable.isActive, true), eq(webhookTable.provider, 'microsoftteams')))

    logger.info(
      `Found ${webhooksWithWorkflows.length} active Teams webhooks, checking for expiring subscriptions`
    )

    // Renewal threshold: 48 hours before expiration
    const renewalThreshold = new Date(Date.now() + 48 * 60 * 60 * 1000)

    for (const { webhook, workflow } of webhooksWithWorkflows) {
      const config = (webhook.providerConfig as Record<string, any>) || {}

      // Check if this is a Teams chat subscription that needs renewal
      if (config.triggerId !== 'microsoftteams_chat_subscription') continue

      const expirationStr = config.subscriptionExpiration as string | undefined
      if (!expirationStr) continue

      const expiresAt = new Date(expirationStr)
      if (expiresAt > renewalThreshold) continue // Not expiring soon

      totalChecked++

      try {
        logger.info(
          `Renewing Teams subscription for webhook ${webhook.id} (expires: ${expiresAt.toISOString()})`
        )

        const credentialId = config.credentialId as string | undefined
        const externalSubscriptionId = config.externalSubscriptionId as string | undefined

        if (!credentialId || !externalSubscriptionId) {
          logger.error(`Missing credentialId or externalSubscriptionId for webhook ${webhook.id}`)
          totalFailed++
          continue
        }

        // Get fresh access token
        const accessToken = await refreshAccessTokenIfNeeded(
          credentialId,
          workflow.userId,
          `renewal-${webhook.id}`
        )

        if (!accessToken) {
          logger.error(`Failed to get access token for webhook ${webhook.id}`)
          totalFailed++
          continue
        }

        // Extend subscription to maximum lifetime (4230 minutes = ~3 days)
        const maxLifetimeMinutes = 4230
        const newExpirationDateTime = new Date(
          Date.now() + maxLifetimeMinutes * 60 * 1000
        ).toISOString()

        const res = await fetch(
          `https://graph.microsoft.com/v1.0/subscriptions/${externalSubscriptionId}`,
          {
            method: 'PATCH',
            signal: AbortSignal.timeout(30_000),
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expirationDateTime: newExpirationDateTime }),
          }
        )

        if (!res.ok) {
          const error = await res.json()
          logger.error(
            `Failed to renew Teams subscription ${externalSubscriptionId} for webhook ${webhook.id}`,
            { status: res.status, error: error.error }
          )
          totalFailed++
          continue
        }

        const payload = await res.json()

        const [updated] = await db
          .update(webhookTable)
          .set({
            providerConfig: sql`jsonb_set(coalesce(${webhookTable.providerConfig}::jsonb, '{}'::jsonb), '{subscriptionExpiration}', to_jsonb(${payload.expirationDateTime}::text), true)::json`,
            updatedAt: sql`date_trunc('milliseconds', greatest(clock_timestamp(), ${webhookTable.updatedAt} + interval '1 millisecond'))`,
          })
          .where(
            and(
              eq(webhookTable.id, webhook.id),
              eq(webhookTable.provider, 'microsoftteams'),
              eq(webhookTable.isActive, true),
              sql`${webhookTable.providerConfig}->>'externalSubscriptionId' = ${externalSubscriptionId}`
            )
          )
          .returning({ id: webhookTable.id })
        if (!updated) {
          totalFailed++
          continue
        }

        logger.info(
          `Successfully renewed Teams subscription for webhook ${webhook.id}. New expiration: ${payload.expirationDateTime}`
        )
        totalRenewed++
      } catch (error) {
        logger.error(`Error renewing subscription for webhook ${webhook.id}:`, error)
        totalFailed++
      }
    }

    logger.info(
      `Teams subscription renewal job completed. Checked: ${totalChecked}, Renewed: ${totalRenewed}, Failed: ${totalFailed}`
    )

    return NextResponse.json({
      success: true,
      checked: totalChecked,
      renewed: totalRenewed,
      failed: totalFailed,
      total: webhooksWithWorkflows.length,
    })
  } catch (error) {
    logger.error('Error in Teams subscription renewal job:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
