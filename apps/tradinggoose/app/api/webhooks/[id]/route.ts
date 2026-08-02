import { db } from '@tradinggoose/db'
import { webhook, workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { createLogger } from '@/lib/logs/console/logger'
import { isMonitorProvider } from '@/lib/monitors/sources'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import {
  deleteTeamsWebhook,
  deleteWebflowWebhook,
  getAirtableDeclarativeProviderConfig,
  getAirtableWebhookCleanup,
  getAirtableWebhookLifecycle,
  getExternalSubscriptionCredentialIds,
  getExternalSubscriptionDeclarativeConfig,
  getPendingAirtableWebhookCleanup,
  getWebhookRevision,
  getWebhookSnapshotRevision,
  lockExternalSubscriptionCredentials,
  processAirtableWebhookCleanup,
  setAirtableWebhookLifecycle,
  setPendingAirtableWebhookCleanup,
  toPublicAirtableWebhook,
} from '@/lib/webhooks/webhook-helpers'

const logger = createLogger('WebhookAPI')
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const { id } = await params
    logger.debug(`[${requestId}] Fetching webhook with ID: ${id}`)
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)
    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }
    const webhookData = webhooks[0]
    if (isMonitorProvider(webhookData.webhook.provider)) {
      logger.warn(`[${requestId}] Generic webhook read blocked for monitor webhook: ${id}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }
    let hasAccess = false
    if (webhookData.workflow.userId === session.user.id) {
      hasAccess = true
    }
    if (!hasAccess && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission !== null) {
        hasAccess = true
      }
    }
    if (!hasAccess) {
      logger.warn(`[${requestId}] User ${session.user.id} denied access to webhook: ${id}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    logger.info(`[${requestId}] Successfully retrieved webhook: ${id}`)
    webhookData.webhook = toPublicAirtableWebhook(webhookData.webhook)
    return NextResponse.json({ webhook: webhookData }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhook`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  try {
    const { id } = await params
    logger.debug(`[${requestId}] Updating webhook with ID: ${id}`)
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json()
    if (Object.hasOwn(body, 'provider')) {
      return NextResponse.json(
        { error: 'Webhook provider changes must use POST /api/webhooks' },
        { status: 409 }
      )
    }
    const { path, providerConfig, isActive } = body
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)
    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }
    const webhookData = webhooks[0]
    if (isMonitorProvider(webhookData.webhook.provider)) {
      logger.warn(`[${requestId}] Generic webhook update blocked for monitor webhook: ${id}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    let canModify = false
    if (webhookData.workflow.userId === session.user.id) {
      canModify = true
    }
    if (!canModify && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canModify = true
      }
    }
    if (!canModify) {
      logger.warn(
        `[${requestId}] User ${session.user.id} denied permission to modify webhook: ${id}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (!webhookData.webhook.provider || webhookData.webhook.provider === 'airtable') {
      return NextResponse.json(
        { error: 'Webhook must be configured through POST /api/webhooks' },
        { status: 409 }
      )
    }
    logger.debug(`[${requestId}] Updating webhook properties`, {
      hasPathUpdate: path !== undefined,
      hasConfigUpdate: providerConfig !== undefined,
      hasActiveUpdate: isActive !== undefined,
    })
    const currentWebhook = webhookData.webhook
    let nextProviderConfig =
      providerConfig !== undefined ? providerConfig : currentWebhook.providerConfig
    if (
      providerConfig !== undefined &&
      (currentWebhook.provider === 'webflow' || currentWebhook.provider === 'microsoftteams')
    ) {
      const currentConfig = currentWebhook.providerConfig as Record<string, unknown> | null
      const externalId =
        currentWebhook.provider === 'webflow'
          ? currentConfig?.externalId
          : currentConfig?.externalSubscriptionId
      if (
        typeof externalId === 'string' &&
        externalId &&
        stableStringifyJsonValue(
          getExternalSubscriptionDeclarativeConfig(
            currentWebhook.provider,
            currentWebhook.providerConfig
          )
        ) !==
          stableStringifyJsonValue(
            getExternalSubscriptionDeclarativeConfig(currentWebhook.provider, providerConfig)
          )
      ) {
        return NextResponse.json(
          { error: 'Delete the webhook before changing its external subscription' },
          { status: 409 }
        )
      }
      if (typeof externalId === 'string' && externalId) {
        nextProviderConfig = currentWebhook.providerConfig
      }
    }
    const revision = getWebhookSnapshotRevision(currentWebhook)
    const credentialIds = getExternalSubscriptionCredentialIds({
      provider: currentWebhook.provider,
      providerConfig: nextProviderConfig,
    })
    const updateWebhook = (client: any) =>
      client
        .update(webhook)
        .set({
          path: path !== undefined ? path : currentWebhook.path,
          providerConfig: nextProviderConfig,
          isActive: isActive !== undefined ? isActive : currentWebhook.isActive,
          updatedAt: revision.updatedAt,
        })
        .where(revision.where)
        .returning()
    const updatedWebhook = credentialIds.length
      ? await db.transaction(async (tx) => {
          await lockExternalSubscriptionCredentials(tx, credentialIds)
          return updateWebhook(tx)
        })
      : await updateWebhook(db)
    if (!updatedWebhook[0]) {
      return NextResponse.json({ error: 'Webhook changed during update' }, { status: 409 })
    }
    logger.info(`[${requestId}] Successfully updated webhook: ${id}`)
    return NextResponse.json({ webhook: updatedWebhook[0] }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error updating webhook`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  try {
    const { id } = await params
    logger.debug(`[${requestId}] Deleting webhook with ID: ${id}`)
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhook deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
          workspaceId: workflow.workspaceId,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(webhook.id, id))
      .limit(1)
    if (webhooks.length === 0) {
      logger.warn(`[${requestId}] Webhook not found: ${id}`)
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }
    const webhookData = webhooks[0]
    if (isMonitorProvider(webhookData.webhook.provider)) {
      logger.warn(`[${requestId}] Generic webhook delete blocked for monitor webhook: ${id}`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    let canDelete = false
    if (webhookData.workflow.userId === session.user.id) {
      canDelete = true
    }
    if (!canDelete && webhookData.workflow.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        webhookData.workflow.workspaceId
      )
      if (userPermission === 'write' || userPermission === 'admin') {
        canDelete = true
      }
    }
    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${session.user.id} denied permission to delete webhook: ${id}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    const foundWebhook = webhookData.webhook
    if (foundWebhook.provider === 'airtable') {
      const existingLifecycle = getAirtableWebhookLifecycle(foundWebhook.providerConfig)
      if (
        existingLifecycle?.phase === 'provisioning' ||
        (existingLifecycle?.phase === 'cleanup' && existingLifecycle.resume?.phase !== 'deleting')
      ) {
        return NextResponse.json(
          { error: 'Airtable webhook update already in progress' },
          { status: 409 }
        )
      }
      const scope = {
        userId: session.user.id,
        workspaceId: webhookData.workflow.workspaceId ?? undefined,
      }
      let current = foundWebhook
      if (!existingLifecycle) {
        const activeCleanup = getAirtableWebhookCleanup(foundWebhook.providerConfig)
        const cleanup = [
          ...getPendingAirtableWebhookCleanup(foundWebhook.providerConfig),
          ...(activeCleanup ? [activeCleanup] : []),
        ]
        const deletingConfig = setPendingAirtableWebhookCleanup(
          getAirtableDeclarativeProviderConfig(foundWebhook.providerConfig),
          cleanup
        )
        const lifecycleConfig = setAirtableWebhookLifecycle(deletingConfig, {
          phase: 'deleting',
        })
        const deletion = getWebhookRevision(foundWebhook, eq(webhook.provider, 'airtable'))
        const [deletingWebhook] = await db
          .update(webhook)
          .set({
            providerConfig: lifecycleConfig,
            isActive: false,
            updatedAt: deletion.updatedAt,
          })
          .where(deletion.where)
          .returning()
        if (!deletingWebhook) {
          return NextResponse.json(
            { error: 'Airtable webhook update already in progress' },
            { status: 409 }
          )
        }
        current = deletingWebhook
      }
      while (
        getPendingAirtableWebhookCleanup(current.providerConfig).length ||
        getAirtableWebhookLifecycle(current.providerConfig)?.phase === 'cleanup'
      ) {
        const result = await processAirtableWebhookCleanup(current, requestId, scope)
        if (!result.cleaned) {
          return NextResponse.json(
            { error: 'Failed to delete webhook from Airtable' },
            { status: 500 }
          )
        }
        if (!result.webhook) return NextResponse.json({ success: true }, { status: 200 })
        current = result.webhook
      }
      const finalDeletion = getWebhookRevision(current, eq(webhook.provider, 'airtable'))
      const [deletedWebhook] = await db.delete(webhook).where(finalDeletion.where).returning()
      if (!deletedWebhook) {
        return NextResponse.json(
          { error: 'Airtable webhook update already in progress' },
          { status: 409 }
        )
      }
      return NextResponse.json({ success: true }, { status: 200 })
    }
    const deletion = getWebhookSnapshotRevision(foundWebhook)
    let deletedWebhook: typeof webhook.$inferSelect | null
    if (foundWebhook.provider === 'microsoftteams') {
      deletedWebhook = await deleteTeamsWebhook(foundWebhook, webhookData.workflow, requestId)
    } else if (foundWebhook.provider === 'webflow') {
      deletedWebhook = await deleteWebflowWebhook(foundWebhook, webhookData.workflow, requestId)
    } else if (foundWebhook.provider === 'telegram') {
      const { botToken } = (foundWebhook.providerConfig || {}) as { botToken?: string }
      if (!botToken) {
        return NextResponse.json(
          { error: 'Missing botToken for Telegram webhook deletion' },
          { status: 400 }
        )
      }
      deletedWebhook = await db.transaction(async (tx) => {
        const [deleted] = await tx.delete(webhook).where(deletion.where).returning()
        if (!deleted) return null
        const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
          method: 'POST',
          signal: AbortSignal.timeout(30_000),
          headers: { 'Content-Type': 'application/json' },
        })
        const body = await response.json()
        if (!response.ok || !body.ok) {
          throw new Error(body.description || 'Telegram webhook deletion failed')
        }
        return deleted
      })
    } else {
      ;[deletedWebhook] = await db.delete(webhook).where(deletion.where).returning()
    }
    if (!deletedWebhook) {
      return NextResponse.json({ error: 'Webhook changed during deletion' }, { status: 409 })
    }
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deleting webhook`, {
      error: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
