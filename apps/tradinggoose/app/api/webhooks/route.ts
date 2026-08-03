import { db } from '@tradinggoose/db'
import { webhook, workflow } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  getOAuthAccessTokenForUserCredential,
  resolveOAuthCredentialAccountForUser,
} from '@/lib/credentials/oauth'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { createLogger } from '@/lib/logs/console/logger'
import { isMonitorProvider } from '@/lib/monitors/sources'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import {
  AirtableWebhookRejectedError,
  createAirtableWebhookSubscription,
  createTeamsSubscription,
  createWebflowWebhookSubscription,
  generateMicrosoftTeamsChatCallbackPath,
  getAirtableDeclarativeProviderConfig,
  getAirtableWebhookCleanup,
  getAirtableWebhookLifecycle,
  getExternalSubscriptionCredentialIds,
  getExternalSubscriptionDeclarativeConfig,
  getPendingAirtableWebhookCleanup,
  getWebhookRevision,
  getWebhookSnapshotRevision,
  lockExternalSubscriptionCredentials,
  setAirtableWebhookDeadline,
  setAirtableWebhookLifecycle,
  setPendingAirtableWebhookCleanup,
  toPublicAirtableWebhook,
  validateAirtableWebhookConfig,
  WebhookRevisionConflictError,
} from '@/lib/webhooks/webhook-helpers'

const logger = createLogger('WebhooksAPI')
export const dynamic = 'force-dynamic'
const isGenericWebhook = (candidate: Pick<typeof webhook.$inferSelect, 'provider'>) =>
  !isMonitorProvider(candidate.provider)
const sanitizeWebhookResults = <T extends { webhook: typeof webhook.$inferSelect }>(results: T[]) =>
  results.map((result) => ({ ...result, webhook: toPublicAirtableWebhook(result.webhook) }))
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized webhooks access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const workflowId = searchParams.get('workflowId')
    const blockId = searchParams.get('blockId')
    if (workflowId && blockId) {
      const wf = await db
        .select({ id: workflow.id, userId: workflow.userId, workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)
      if (!wf.length) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }
      const wfRecord = wf[0]
      let canRead = wfRecord.userId === session.user.id
      if (!canRead && wfRecord.workspaceId) {
        const permission = await getUserEntityPermissions(
          session.user.id,
          'workspace',
          wfRecord.workspaceId
        )
        canRead = permission === 'read' || permission === 'write' || permission === 'admin'
      }
      if (!canRead) {
        logger.warn(
          `[${requestId}] User ${session.user.id} denied permission to read webhooks for workflow ${workflowId}`
        )
        return NextResponse.json({ webhooks: [] }, { status: 200 })
      }
      const webhooks = await db
        .select({
          webhook: webhook,
          workflow: {
            id: workflow.id,
            name: workflow.name,
          },
        })
        .from(webhook)
        .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
        .where(and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId)))
        .orderBy(desc(webhook.updatedAt))
      const genericWebhooks = webhooks.filter(({ webhook: candidate }) =>
        isGenericWebhook(candidate)
      )
      logger.info(
        `[${requestId}] Retrieved ${genericWebhooks.length} webhooks for workflow ${workflowId} block ${blockId}`
      )
      return NextResponse.json(
        { webhooks: sanitizeWebhookResults(genericWebhooks) },
        { status: 200 }
      )
    }
    if (workflowId && !blockId) {
      return NextResponse.json({ webhooks: [] }, { status: 200 })
    }
    logger.debug(`[${requestId}] Fetching user-owned webhooks for ${session.user.id}`)
    const webhooks = await db
      .select({
        webhook: webhook,
        workflow: {
          id: workflow.id,
          name: workflow.name,
        },
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(eq(workflow.userId, session.user.id))

    const genericWebhooks = webhooks.filter(({ webhook: candidate }) => isGenericWebhook(candidate))
    logger.info(`[${requestId}] Retrieved ${genericWebhooks.length} user-owned webhooks`)
    return NextResponse.json({ webhooks: sanitizeWebhookResults(genericWebhooks) }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching webhooks`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  const userId = (await getSession())?.user?.id
  if (!userId) {
    logger.warn(`[${requestId}] Unauthorized webhook creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await request.json()
    const { workflowId, path, provider: requestedProvider, providerConfig, blockId } = body
    const provider = typeof requestedProvider === 'string' ? requestedProvider.trim() : ''
    if (!provider) {
      logger.warn(`[${requestId}] Missing provider for webhook creation`)
      return NextResponse.json({ error: 'Missing required provider' }, { status: 400 })
    }
    if (isMonitorProvider(provider)) {
      logger.warn(`[${requestId}] Denied monitor webhook creation through generic webhook API`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!workflowId) {
      logger.warn(`[${requestId}] Missing required fields for webhook creation`, {
        hasWorkflowId: !!workflowId,
        hasPath: !!path,
      })
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    let finalPath = path
    const credentialBasedProviders = ['gmail', 'outlook']
    const isCredentialBased = credentialBasedProviders.includes(provider)
    const isMicrosoftTeamsChatSubscription =
      provider === 'microsoftteams' &&
      typeof providerConfig === 'object' &&
      providerConfig?.triggerId === 'microsoftteams_chat_subscription'
    if (isMicrosoftTeamsChatSubscription) finalPath = ''
    if (!finalPath || finalPath.trim() === '') {
      if (isCredentialBased || isMicrosoftTeamsChatSubscription) {
        if (blockId) {
          const existingForBlock = (
            await db
              .select({ id: webhook.id, path: webhook.path, provider: webhook.provider })
              .from(webhook)
              .where(and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId)))
          ).find(isGenericWebhook)
          if (existingForBlock) {
            finalPath = existingForBlock.path
            logger.info(
              `[${requestId}] Reusing existing generated path for ${provider} trigger: ${finalPath}`
            )
          }
        }
        if (!finalPath || finalPath.trim() === '') {
          finalPath = isMicrosoftTeamsChatSubscription
            ? generateMicrosoftTeamsChatCallbackPath()
            : `${provider}-${crypto.randomUUID()}`
          logger.info(`[${requestId}] Generated webhook path for ${provider} trigger: ${finalPath}`)
        }
      } else {
        logger.warn(`[${requestId}] Missing path for webhook creation`, {
          hasWorkflowId: !!workflowId,
          hasPath: !!path,
        })
        return NextResponse.json({ error: 'Missing required path' }, { status: 400 })
      }
    }
    const workflowData = await db
      .select({
        id: workflow.id,
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)
    if (workflowData.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }
    const workflowRecord = workflowData[0]
    const workspaceId = workflowRecord.workspaceId
    if (!workspaceId) {
      return NextResponse.json({ error: 'Workflow workspace is required' }, { status: 400 })
    }
    let canModify = false
    if (workflowRecord.userId === userId) {
      canModify = true
    }
    if (!canModify) {
      const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (userPermission === 'write' || userPermission === 'admin') {
        canModify = true
      }
    }
    if (!canModify) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to modify webhook for workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    const credentialId =
      providerConfig && typeof providerConfig === 'object'
        ? (providerConfig as Record<string, unknown>).credentialId
        : null
    if (typeof credentialId === 'string' && credentialId.trim()) {
      const credentialAccess = await resolveOAuthCredentialAccountForUser({
        credentialId: credentialId.trim(),
        userId,
        workspaceId,
      })
      if (!credentialAccess) {
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }
    }
    let previousWebhook: typeof webhook.$inferSelect | null = null
    let targetWebhookId: string | null = null
    if (isCredentialBased && blockId) {
      const existingForBlock = (
        await db
          .select()
          .from(webhook)
          .where(and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId)))
      ).find(isGenericWebhook)
      if (existingForBlock) {
        previousWebhook = existingForBlock
        targetWebhookId = previousWebhook.id
      }
    }
    if (!targetWebhookId) {
      const existingByPath = await db
        .select()
        .from(webhook)
        .where(eq(webhook.path, finalPath))
        .limit(1)
      if (existingByPath.length > 0) {
        if (isMonitorProvider(existingByPath[0].provider)) {
          logger.warn(`[${requestId}] Generic webhook upsert blocked for monitor path collision`, {
            path: finalPath,
          })
          return NextResponse.json(
            { error: 'Webhook path already exists.', code: 'PATH_EXISTS' },
            { status: 409 }
          )
        }
        if (existingByPath[0].workflowId !== workflowId) {
          logger.warn(`[${requestId}] Webhook path conflict: ${finalPath}`)
          return NextResponse.json(
            { error: 'Webhook path already exists.', code: 'PATH_EXISTS' },
            { status: 409 }
          )
        }
        previousWebhook = existingByPath[0]
        targetWebhookId = previousWebhook.id
      }
    }
    const webhookId = targetWebhookId ?? nanoid()
    if (getAirtableWebhookLifecycle(previousWebhook?.providerConfig)) {
      return NextResponse.json(
        { error: 'Airtable webhook update already in progress' },
        { status: 409 }
      )
    }
    if (previousWebhook?.provider && previousWebhook.provider !== provider) {
      return NextResponse.json(
        { error: 'Delete the webhook before changing providers' },
        { status: 409 }
      )
    }
    const airtableScope = {
      userId,
      workspaceId,
    }
    let finalProviderConfig = providerConfig
    let shouldProvisionWebflow = provider === 'webflow'
    let airtableClaimedAt: Date | undefined
    if (provider === 'airtable') {
      const incomingConfig = getAirtableDeclarativeProviderConfig(providerConfig)
      let airtableCredentialId: string
      try {
        ;({ credentialId: airtableCredentialId } = validateAirtableWebhookConfig(incomingConfig))
      } catch (error) {
        return airtableSetupFailureResponse(error)
      }
      const storedProviderConfig = previousWebhook?.providerConfig
      const activeCleanup = getAirtableWebhookCleanup(storedProviderConfig)
      if (
        previousWebhook?.provider === 'airtable' &&
        activeCleanup &&
        stableStringifyJsonValue(getAirtableDeclarativeProviderConfig(storedProviderConfig)) ===
          stableStringifyJsonValue(incomingConfig)
      ) {
        finalProviderConfig = storedProviderConfig
      } else {
        const lifecycle = {
          phase: 'provisioning' as const,
          emptyObservations: 0 as const,
          expiresAt: 0,
          previous: previousWebhook
            ? {
                blockId: previousWebhook.blockId,
                provider: previousWebhook.provider,
                providerConfig: previousWebhook.providerConfig,
                isActive: previousWebhook.isActive,
              }
            : null,
        }
        const claimedConfig = setAirtableWebhookLifecycle(incomingConfig, lifecycle)
        const claim = previousWebhook ? getWebhookSnapshotRevision(previousWebhook) : null
        const claimedAt = claim?.updatedAt ?? new Date()
        const claimed = await db.transaction(async (tx) => {
          await lockExternalSubscriptionCredentials(tx, [airtableCredentialId])
          return previousWebhook
            ? tx
                .update(webhook)
                .set({
                  provider: 'airtable',
                  providerConfig: setAirtableWebhookDeadline(claimedConfig),
                  isActive: false,
                  updatedAt: claimedAt,
                })
                .where(claim?.where)
                .returning()
            : tx
                .insert(webhook)
                .values({
                  id: webhookId,
                  workflowId,
                  blockId,
                  path: finalPath,
                  provider: 'airtable',
                  providerConfig: setAirtableWebhookDeadline(claimedConfig),
                  isActive: false,
                  createdAt: claimedAt,
                  updatedAt: claimedAt,
                })
                .returning()
        })
        if (!claimed[0]) throw new WebhookRevisionConflictError()
        airtableClaimedAt = claimed[0].updatedAt
        try {
          const airtableAccessToken = await getOAuthAccessTokenForUserCredential({
            credentialId: airtableCredentialId,
            ...airtableScope,
            requestId,
          }).catch(() => null)
          if (!airtableAccessToken) {
            throw new AirtableWebhookRejectedError('Airtable account connection required.')
          }
          const airtableSubscription = await createAirtableWebhookSubscription(
            { id: webhookId, path: finalPath, providerConfig: incomingConfig },
            requestId,
            airtableAccessToken
          )
          finalProviderConfig = setPendingAirtableWebhookCleanup(
            { ...incomingConfig, externalId: airtableSubscription.externalId },
            [
              ...getPendingAirtableWebhookCleanup(storedProviderConfig),
              ...(previousWebhook?.provider === 'airtable' && activeCleanup ? [activeCleanup] : []),
            ]
          )
        } catch (error) {
          logger.error(`[${requestId}] Error creating Airtable webhook`, error)
          if (error instanceof AirtableWebhookRejectedError) {
            const release = getWebhookRevision(
              { id: webhookId, updatedAt: claimedAt },
              eq(webhook.provider, 'airtable')
            )
            const released = lifecycle.previous
              ? await db
                  .update(webhook)
                  .set({
                    ...lifecycle.previous,
                    updatedAt: release.updatedAt,
                  })
                  .where(release.where)
                  .returning()
              : await db.delete(webhook).where(release.where).returning()
            if (!released[0]) throw new WebhookRevisionConflictError()
          }
          return airtableSetupFailureResponse(error)
        }
      }
    }
    if (
      previousWebhook?.provider === provider &&
      (provider === 'webflow' || isMicrosoftTeamsChatSubscription)
    ) {
      const storedConfig = previousWebhook.providerConfig as Record<string, unknown> | null
      const externalId =
        provider === 'webflow' ? storedConfig?.externalId : storedConfig?.externalSubscriptionId
      if (typeof externalId === 'string' && externalId) {
        const unchanged =
          stableStringifyJsonValue(
            getExternalSubscriptionDeclarativeConfig(provider, storedConfig)
          ) ===
          stableStringifyJsonValue(
            getExternalSubscriptionDeclarativeConfig(provider, finalProviderConfig)
          )
        if (!unchanged) {
          return NextResponse.json(
            { error: 'Delete the webhook before changing its external subscription' },
            { status: 409 }
          )
        }
        finalProviderConfig = storedConfig
        if (provider === 'webflow') shouldProvisionWebflow = false
      }
    }
    let savedWebhook: typeof webhook.$inferSelect | undefined
    if (airtableClaimedAt) {
      const adoption = getWebhookRevision(
        { id: webhookId, updatedAt: airtableClaimedAt },
        eq(webhook.provider, 'airtable')
      )
      const adopted = await db
        .update(webhook)
        .set({
          blockId,
          provider: 'airtable',
          providerConfig: finalProviderConfig,
          isActive: true,
          updatedAt: adoption.updatedAt,
        })
        .where(adoption.where)
        .returning()
      if (!adopted[0]) throw new WebhookRevisionConflictError()
      savedWebhook = adopted[0]
    } else {
      const updatingAirtable = provider === 'airtable'
      let writeWebhook: (client: any) => Promise<(typeof webhook.$inferSelect)[]>
      if (targetWebhookId && previousWebhook) {
        const revision = getWebhookSnapshotRevision(previousWebhook)
        logger.info(`[${requestId}] Updating existing webhook for path: ${finalPath}`, {
          webhookId: targetWebhookId,
          provider,
          hasCredentialId: !!(finalProviderConfig as Record<string, unknown>)?.credentialId,
        })
        writeWebhook = (client) =>
          client
            .update(webhook)
            .set({
              blockId,
              provider,
              providerConfig: finalProviderConfig,
              isActive: true,
              updatedAt: revision.updatedAt,
            })
            .where(revision.where)
            .returning()
      } else {
        const createdAt = new Date()
        logger.info(`[${requestId}] Creating new webhook with ID: ${webhookId}`)
        writeWebhook = (client) =>
          client
            .insert(webhook)
            .values({
              id: webhookId,
              workflowId,
              blockId,
              path: finalPath,
              provider,
              providerConfig: finalProviderConfig,
              isActive: true,
              createdAt,
              updatedAt: createdAt,
            })
            .returning()
      }
      const webhookCandidate = {
        id: webhookId,
        path: finalPath,
        provider,
        providerConfig: finalProviderConfig,
      }
      if (isMicrosoftTeamsChatSubscription) {
        const configured = await createTeamsSubscription(
          webhookCandidate,
          { workspaceId },
          requestId,
          writeWebhook
        )
        if (!configured) {
          return NextResponse.json(
            {
              error: 'Failed to create Teams subscription',
              details: 'Could not create subscription with Microsoft Graph API',
            },
            { status: 500 }
          )
        }
        savedWebhook = configured
      } else if (provider === 'webflow' && shouldProvisionWebflow) {
        try {
          savedWebhook = await createWebflowWebhookSubscription(
            webhookCandidate,
            requestId,
            {
              userId,
              workspaceId,
            },
            writeWebhook
          )
        } catch (err) {
          if (err instanceof WebhookRevisionConflictError) throw err
          logger.error(`[${requestId}] Error creating Webflow webhook`, err)
          return NextResponse.json(
            {
              error: 'Failed to create webhook in Webflow',
              details: err instanceof Error ? err.message : 'Unknown error',
            },
            { status: 500 }
          )
        }
      } else {
        const credentialIds = getExternalSubscriptionCredentialIds(webhookCandidate)
        const saved = credentialIds.length
          ? await db.transaction(async (tx) => {
              await lockExternalSubscriptionCredentials(tx, credentialIds)
              return writeWebhook(tx)
            })
          : await writeWebhook(db)
        if (!saved[0] && targetWebhookId) {
          return NextResponse.json(
            {
              error: updatingAirtable ? 'Airtable webhook update already in progress' : 'Conflict',
            },
            { status: 409 }
          )
        }
        savedWebhook = saved[0]
      }
    }
    if (savedWebhook && provider === 'telegram') {
      const { createTelegramWebhook } = await import('@/lib/webhooks/webhook-helpers')
      const configured = await createTelegramWebhook(savedWebhook, requestId)
      if (!configured) {
        return NextResponse.json(
          {
            error: 'Failed to create Telegram webhook',
          },
          { status: 500 }
        )
      }
      savedWebhook = configured
    }
    if (savedWebhook && (provider === 'gmail' || provider === 'outlook')) {
      try {
        const polling = await import('@/lib/webhooks/utils')
        const configure =
          provider === 'gmail' ? polling.configureGmailPolling : polling.configureOutlookPolling
        const configured = await configure(savedWebhook, requestId, workspaceId)
        if (!configured) {
          return NextResponse.json(
            { error: `Failed to configure ${provider} polling` },
            { status: 500 }
          )
        }
        savedWebhook = configured
      } catch (err) {
        if (err instanceof WebhookRevisionConflictError) throw err
        logger.error(`[${requestId}] Failed to configure ${provider} polling`, err)
        return NextResponse.json(
          {
            error: `Failed to configure ${provider} webhook`,
            details: err instanceof Error ? err.message : 'Unknown error',
          },
          { status: 500 }
        )
      }
    }
    const status = targetWebhookId ? 200 : 201
    return NextResponse.json(
      { webhook: savedWebhook ? toPublicAirtableWebhook(savedWebhook) : savedWebhook },
      { status }
    )
  } catch (error: any) {
    if (error instanceof WebhookRevisionConflictError) {
      return NextResponse.json({ error: 'Webhook changed during setup' }, { status: 409 })
    }
    const databaseError = error?.cause ?? error
    if (databaseError?.code === '23505' && databaseError?.constraint_name === 'path_idx') {
      return NextResponse.json(
        { error: 'Webhook path already exists.', code: 'PATH_EXISTS' },
        { status: 409 }
      )
    }
    logger.error(`[${requestId}] Error creating/updating webhook`, {
      message: error.message,
      stack: error.stack,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
function airtableSetupFailureResponse(error: unknown) {
  return NextResponse.json(
    {
      error: 'Failed to create webhook in Airtable',
      details: error instanceof Error ? error.message : 'Unknown error',
    },
    { status: 500 }
  )
}
