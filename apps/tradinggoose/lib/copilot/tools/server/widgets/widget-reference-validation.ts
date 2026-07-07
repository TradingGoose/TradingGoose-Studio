import { db } from '@tradinggoose/db'
import {
  customTools,
  mcpServers,
  pineIndicators,
  skill,
  watchlistTable,
  workflow,
} from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import type { ListingIdentity } from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'
import type { LayoutNode, PersistedColorPairsState } from '@/widgets/layout'
import { isWidgetKey, type WidgetReferenceParamField } from '@/widgets/widget-contracts'
import {
  collectDashboardLayoutReferenceCandidates,
  createWidgetConfigValidationError,
  type PlannedWidgetConfigMutation,
  type WidgetReferenceValidationResult,
} from '@/widgets/widget-mutations'

type WidgetReferenceValidationScope = {
  workspaceId: string
  ownerUserId: string
}

export async function validateDashboardLayoutWidgetReferences(
  scope: WidgetReferenceValidationScope,
  layout: LayoutNode,
  colorPairs: PersistedColorPairsState | unknown
): Promise<void> {
  const references = new Map<string, { field: WidgetReferenceParamField; id: string }>()

  for (const candidate of collectDashboardLayoutReferenceCandidates(layout, colorPairs)) {
    references.set(`${candidate.field}:${candidate.value}`, {
      field: candidate.field,
      id: candidate.value,
    })
  }

  await Promise.all(
    [...references.values()].map(({ field, id }) => requireWidgetReference(scope, field, id, field))
  )
}

export async function validateWidgetReferenceCandidates(
  scope: WidgetReferenceValidationScope,
  plan: Pick<PlannedWidgetConfigMutation, 'panelId' | 'afterWidget' | 'references'>
): Promise<WidgetReferenceValidationResult> {
  const candidates = plan.references
  if (!plan.afterWidget?.key || !isWidgetKey(plan.afterWidget.key)) {
    throw new Error('Widget reference validation requires a valid target widget key')
  }

  await Promise.all(
    candidates.map((candidate) =>
      requireWidgetReference(scope, candidate.field, candidate.value, candidate.path)
    )
  )

  return {
    workspaceId: scope.workspaceId,
    ownerUserId: scope.ownerUserId,
    panelId: plan.panelId,
    widgetKey: plan.afterWidget.key,
    candidates,
  }
}

async function requireWidgetReference(
  scope: WidgetReferenceValidationScope,
  field: WidgetReferenceParamField,
  id: string,
  path: string
) {
  let rows: Array<{ id: string }>
  switch (field) {
    case 'workflowId':
      rows = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(and(eq(workflow.id, id), eq(workflow.workspaceId, scope.workspaceId)))
        .limit(1)
      break
    case 'watchlistId':
      rows = await db
        .select({ id: watchlistTable.id })
        .from(watchlistTable)
        .where(
          and(
            eq(watchlistTable.id, id),
            eq(watchlistTable.workspaceId, scope.workspaceId),
            isNull(watchlistTable.userId),
            isNull(watchlistTable.parentId)
          )
        )
        .limit(1)
      break
    case 'listing':
      if (!(await resolveListingIdentity(parseListingIdentityKey(id, path)).catch(() => null))) {
        throw createWidgetConfigValidationError(
          path,
          `Widget listing reference "${id}" is not resolvable`
        )
      }
      return
    case 'indicatorId':
      if (DEFAULT_INDICATOR_RUNTIME_MAP.has(id)) return
      rows = await db
        .select({ id: pineIndicators.id })
        .from(pineIndicators)
        .where(and(eq(pineIndicators.id, id), eq(pineIndicators.workspaceId, scope.workspaceId)))
        .limit(1)
      break
    case 'mcpServerId':
      rows = await db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, id),
            eq(mcpServers.workspaceId, scope.workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .limit(1)
      break
    case 'customToolId':
      rows = await db
        .select({ id: customTools.id })
        .from(customTools)
        .where(and(eq(customTools.id, id), eq(customTools.workspaceId, scope.workspaceId)))
        .limit(1)
      break
    case 'skillId':
      rows = await db
        .select({ id: skill.id })
        .from(skill)
        .where(and(eq(skill.id, id), eq(skill.workspaceId, scope.workspaceId)))
        .limit(1)
      break
  }

  if (rows.length === 0) {
    throw createWidgetConfigValidationError(
      path,
      `Widget ${field} reference "${id}" is not accessible in this workspace`
    )
  }
}

function parseListingIdentityKey(key: string, path: string): ListingIdentity {
  const [listingType, listingId = '', baseId = '', quoteId = ''] = key.split('|')
  if (listingType !== 'default' && listingType !== 'crypto' && listingType !== 'currency') {
    throw createWidgetConfigValidationError(path, `Invalid listing reference "${key}"`)
  }
  return {
    listing_type: listingType,
    listing_id: listingId,
    base_id: baseId,
    quote_id: quoteId,
  }
}
