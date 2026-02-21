import { db } from '@tradinggoose/db'
import { pineIndicators, webhook, workflow, workflowBlocks } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import {
  type IndicatorMonitorAuthStored,
  type IndicatorMonitorProviderConfig,
  toPublicIndicatorMonitorProviderConfig,
} from '@/lib/indicators/monitor-config'
import { isIndicatorTriggerCapable } from '@/lib/indicators/trigger-detection'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import { decryptSecret } from '@/lib/utils'

export const INDICATOR_PROVIDER = 'indicator'

type WebhookRow = typeof webhook.$inferSelect

export const listIndicatorMonitorRows = async ({
  workspaceId,
  workflowId,
  blockId,
}: {
  workspaceId: string
  workflowId?: string
  blockId?: string
}) => {
  const conditions = [
    eq(workflow.workspaceId, workspaceId),
    eq(webhook.provider, INDICATOR_PROVIDER),
  ]

  if (workflowId) {
    conditions.push(eq(webhook.workflowId, workflowId))
  }
  if (blockId) {
    conditions.push(eq(webhook.blockId, blockId))
  }

  return db
    .select({
      webhook: webhook,
      workflow: {
        id: workflow.id,
        workspaceId: workflow.workspaceId,
      },
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(and(...conditions))
    .orderBy(desc(webhook.updatedAt))
}

export const getIndicatorMonitorRowById = async (id: string) => {
  const rows = await db
    .select({
      webhook: webhook,
      workflow: {
        id: workflow.id,
        workspaceId: workflow.workspaceId,
      },
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(and(eq(webhook.id, id), eq(webhook.provider, INDICATOR_PROVIDER)))
    .limit(1)

  return rows[0] ?? null
}

export const ensureIndicatorTriggerBlock = async (workflowId: string, blockId: string) => {
  const rows = await db
    .select({
      id: workflowBlocks.id,
      type: workflowBlocks.type,
    })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.id, blockId), eq(workflowBlocks.workflowId, workflowId)))
    .limit(1)

  const block = rows[0]
  if (!block) {
    throw new Error('Target block not found in workflow.')
  }
  if (block.type !== 'indicator_trigger') {
    throw new Error('Target block must be of type indicator_trigger.')
  }
}

export const ensureWorkflowInWorkspace = async (workflowId: string, workspaceId: string) => {
  const rows = await db
    .select({
      id: workflow.id,
      workspaceId: workflow.workspaceId,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  const workflowRow = rows[0]
  if (!workflowRow) {
    throw new Error('Target workflow not found.')
  }
  if (workflowRow.workspaceId !== workspaceId) {
    throw new Error('Workflow does not belong to the provided workspace.')
  }
}

export const ensureTriggerCapableIndicator = async (workspaceId: string, indicatorId: string) => {
  const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(indicatorId)
  if (defaultIndicator) {
    if (!isIndicatorTriggerCapable(defaultIndicator.pineCode)) {
      throw new Error(`Indicator ${indicatorId} does not use trigger(...).`)
    }
    return
  }

  const customRows = await db
    .select({
      id: pineIndicators.id,
      pineCode: pineIndicators.pineCode,
    })
    .from(pineIndicators)
    .where(and(eq(pineIndicators.id, indicatorId), eq(pineIndicators.workspaceId, workspaceId)))
    .limit(1)

  const customIndicator = customRows[0]
  if (!customIndicator) {
    throw new Error(`Indicator ${indicatorId} not found.`)
  }
  if (!isIndicatorTriggerCapable(customIndicator.pineCode)) {
    throw new Error(`Indicator ${indicatorId} does not use trigger(...).`)
  }
}

const parseIndicatorProviderConfig = (
  providerConfig: WebhookRow['providerConfig']
): IndicatorMonitorProviderConfig => {
  if (!providerConfig || typeof providerConfig !== 'object') {
    throw new Error('Invalid monitor provider config.')
  }
  return providerConfig as IndicatorMonitorProviderConfig
}

const deriveSecretReferences = async (
  auth?: IndicatorMonitorAuthStored
): Promise<Record<string, string> | undefined> => {
  if (!auth?.encryptedSecrets || Object.keys(auth.encryptedSecrets).length === 0) {
    return undefined
  }

  const references: Record<string, string> = {}
  for (const [fieldId, encryptedValue] of Object.entries(auth.encryptedSecrets)) {
    try {
      const decrypted = (await decryptSecret(encryptedValue)).decrypted?.trim()
      if (decrypted) {
        references[fieldId] = decrypted
      }
    } catch {
      // ignore decrypt failures for unreadable values
    }
  }

  return Object.keys(references).length > 0 ? references : undefined
}

export const toIndicatorMonitorRecord = async (webhookRow: WebhookRow) => {
  const providerConfig = parseIndicatorProviderConfig(webhookRow.providerConfig)
  const derivedSecretReferences = await deriveSecretReferences(providerConfig.monitor.auth)
  const publicProviderConfig = toPublicIndicatorMonitorProviderConfig(providerConfig)
  const resolvedListing = await resolveListingIdentity(publicProviderConfig.monitor.listing).catch(
    () => null
  )
  const auth = publicProviderConfig.monitor.auth

  return {
    monitorId: webhookRow.id,
    workflowId: webhookRow.workflowId,
    blockId: webhookRow.blockId,
    isActive: webhookRow.isActive,
    providerConfig: {
      ...publicProviderConfig,
      monitor: {
        ...publicProviderConfig.monitor,
        ...(derivedSecretReferences
          ? {
              auth: {
                ...(auth ?? {}),
                secretReferences: derivedSecretReferences,
              },
            }
          : {}),
        listing: resolvedListing ?? publicProviderConfig.monitor.listing,
      },
    },
    createdAt: webhookRow.createdAt.toISOString(),
    updatedAt: webhookRow.updatedAt.toISOString(),
  }
}
