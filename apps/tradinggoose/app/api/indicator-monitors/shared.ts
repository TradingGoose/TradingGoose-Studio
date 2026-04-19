import { db } from '@tradinggoose/db'
import {
  pineIndicators,
  webhook,
  workflow,
  workflowDeploymentVersion,
} from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import {
  type IndicatorMonitorAuthStored,
  type IndicatorMonitorProviderConfig,
  toPublicIndicatorMonitorProviderConfig,
} from '@/lib/indicators/monitor-config'
import { isIndicatorTriggerCapable } from '@/lib/indicators/trigger-detection'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import { decryptSecret } from '@/lib/utils-server'

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
    .where(and(...conditions))
    .orderBy(desc(webhook.updatedAt))

  if (!blockId) return rows
  return rows.filter((row) => {
    try {
      return parseIndicatorProviderConfig(row.webhook.providerConfig).monitor.triggerBlockId === blockId
    } catch {
      return false
    }
  })
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

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const getActiveDeployedState = async (workflowId: string) => {
  const rows = await db
    .select({ state: workflowDeploymentVersion.state })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  return rows[0]?.state as Record<string, unknown> | undefined
}

const getDeployedIndicatorTriggerBlockIds = (deployedState: Record<string, unknown> | undefined) => {
  const blocks =
    deployedState && typeof deployedState === 'object'
      ? ((deployedState.blocks as Record<string, unknown> | undefined) ?? undefined)
      : undefined
  if (!blocks || typeof blocks !== 'object') return new Set<string>()

  const ids = Object.entries(blocks)
    .map(([blockId, blockData]) => {
      const block = blockData as { id?: unknown; type?: unknown } | undefined
      if (block?.type !== 'indicator_trigger') return null
      return toTrimmedString(block?.id) ?? toTrimmedString(blockId)
    })
    .filter((value): value is string => Boolean(value))

  return new Set(ids)
}

export const ensureIndicatorTriggerBlockInDeployedState = async (
  workflowId: string,
  blockId: string
) => {
  const deployedState = await getActiveDeployedState(workflowId)
  if (!deployedState) {
    throw new Error('Target workflow has no active deployment.')
  }

  const triggerBlockIds = getDeployedIndicatorTriggerBlockIds(deployedState)
  if (!triggerBlockIds.has(blockId)) {
    throw new Error('Target block must be an indicator_trigger block in the active deployment.')
  }
}

export const ensureWorkflowInWorkspace = async (workflowId: string, workspaceId: string) => {
  const rows = await db
    .select({
      id: workflow.id,
      workspaceId: workflow.workspaceId,
      isDeployed: workflow.isDeployed,
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

  return workflowRow
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
  const listingForResponse = (() => {
    if (!resolvedListing) return publicProviderConfig.monitor.listing
    return resolvedListing
  })()
  const auth = publicProviderConfig.monitor.auth

  return {
    monitorId: webhookRow.id,
    workflowId: webhookRow.workflowId,
    blockId: providerConfig.monitor.triggerBlockId,
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
        listing: listingForResponse,
      },
    },
    createdAt: webhookRow.createdAt.toISOString(),
    updatedAt: webhookRow.updatedAt.toISOString(),
  }
}

export const pauseMonitorsMissingDeployedIndicatorTrigger = async (workflowId: string) => {
  const deployedState = await getActiveDeployedState(workflowId)
  const deployedTriggerBlockIds = getDeployedIndicatorTriggerBlockIds(deployedState)
  const rows = await db
    .select({
      id: webhook.id,
      blockId: webhook.blockId,
      isActive: webhook.isActive,
      providerConfig: webhook.providerConfig,
    })
    .from(webhook)
    .where(and(eq(webhook.workflowId, workflowId), eq(webhook.provider, INDICATOR_PROVIDER)))

  const now = new Date()
  for (const row of rows) {
    let providerConfig: IndicatorMonitorProviderConfig
    try {
      providerConfig = parseIndicatorProviderConfig(row.providerConfig)
    } catch {
      continue
    }
    const triggerBlockId = toTrimmedString(providerConfig.monitor.triggerBlockId)
    if (!triggerBlockId) continue
    if (deployedTriggerBlockIds.has(triggerBlockId)) continue
    if (!row.isActive && row.blockId === null) continue

    await db
      .update(webhook)
      .set({
        isActive: false,
        blockId: null,
        updatedAt: now,
      })
      .where(eq(webhook.id, row.id))
  }
}
