import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { desc, eq } from 'drizzle-orm'
import { ENTITY_KIND_INDICATOR } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { upsertIndicators } from '@/lib/indicators/custom/operations'
import {
  DEFAULT_INDICATOR_RUNTIME_ENTRIES,
  resolveDefaultIndicatorRuntimeEntry,
} from '@/lib/indicators/default/runtime'
import { normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import {
  applySavedEntityYjsStateToRows,
  savedEntityRowToFields,
} from '@/lib/yjs/entity-state'
import {
  acceptEntityDocumentReview,
  buildCreateEntityReviewResult,
  buildDocumentEnvelope,
  buildUpdateEntityReviewResult,
  type CopilotIndicatorListEntry,
  type EntityCreateResult,
  type EntityServerTool,
  readSavedEntityYjsFields,
  requireEntityId,
  requireUserId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

function toDefaultIndicatorListEntry(entry: (typeof DEFAULT_INDICATOR_RUNTIME_ENTRIES)[number]) {
  const inputTitles = Object.keys(entry.inputMeta ?? {})

  return {
    name: entry.name,
    source: 'default' as const,
    editable: false,
    callableInFunctionBlock: true,
    ...(inputTitles.length > 0 ? { inputTitles } : {}),
    runtimeId: entry.id,
  }
}

function toCustomIndicatorListEntry(
  row: Awaited<ReturnType<typeof applySavedEntityYjsStateToRows<typeof pineIndicators.$inferSelect>>>[number]
): CopilotIndicatorListEntry {
  const inputMeta = normalizeInputMetaMap(row.inputMeta)
  const inputTitles = Object.keys(inputMeta ?? {})

  return {
    name: row.name,
    source: 'custom',
    editable: true,
    callableInFunctionBlock: false,
    ...(inputTitles.length > 0 ? { inputTitles } : {}),
    entityId: row.id,
  }
}

async function listCopilotIndicators(workspaceId: string): Promise<CopilotIndicatorListEntry[]> {
  const defaultOptions = DEFAULT_INDICATOR_RUNTIME_ENTRIES.map(toDefaultIndicatorListEntry)
  const customRows = await db
    .select()
    .from(pineIndicators)
    .where(eq(pineIndicators.workspaceId, workspaceId))
    .orderBy(desc(pineIndicators.createdAt))
    .then((rows) => applySavedEntityYjsStateToRows(ENTITY_KIND_INDICATOR, rows))
  const customOptions = customRows.map(toCustomIndicatorListEntry)

  return [...defaultOptions, ...customOptions].sort((a, b) => a.name.localeCompare(b.name))
}

async function createIndicatorEntity(
  fields: Record<string, unknown>,
  context: Parameters<typeof verifyWorkspaceContext>[0]
): Promise<EntityCreateResult> {
  const { userId, workspaceId } = await verifyWorkspaceContext(context, 'write')
  const entityId = crypto.randomUUID()
  const rows = await upsertIndicators({
    userId,
    workspaceId,
    indicators: [
      {
        id: entityId,
        name: String(fields.name ?? ''),
        pineCode: String(fields.pineCode ?? ''),
        inputMeta:
          fields.inputMeta && typeof fields.inputMeta === 'object' && !Array.isArray(fields.inputMeta)
            ? (fields.inputMeta as Record<string, unknown>)
            : undefined,
      },
    ],
  })
  const row = rows.find((candidate) => candidate.id === entityId)
  if (!row) {
    throw new Error('Created indicator was not returned from canonical upsert')
  }

  return {
    entityId,
    fields: savedEntityRowToFields(ENTITY_KIND_INDICATOR, row),
  }
}

export const listIndicatorsServerTool: EntityServerTool<Record<string, never>> = {
  name: 'list_indicators',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const indicators = await listCopilotIndicators(workspaceId)

    return {
      entityKind: ENTITY_KIND_INDICATOR,
      indicators,
      count: indicators.length,
    }
  },
}

export const readIndicatorServerTool: EntityServerTool = {
  name: 'read_indicator',
  async execute(args, context) {
    const runtimeId = args.runtimeId?.trim()
    if (runtimeId) {
      requireUserId(context)
      const indicator = resolveDefaultIndicatorRuntimeEntry(runtimeId)
      if (!indicator) {
        throw new Error(`Built-in indicator ${runtimeId} was not found`)
      }

      return buildDocumentEnvelope(ENTITY_KIND_INDICATOR, undefined, {
        name: indicator.name,
        pineCode: indicator.pineCode,
        inputMeta: indicator.inputMeta ?? null,
      })
    }

    const entityId = requireEntityId(args, 'read_indicator')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_INDICATOR,
      entityId,
      'read'
    )
    const fields = await readSavedEntityYjsFields(ENTITY_KIND_INDICATOR, entityId, workspaceId)
    return buildDocumentEnvelope(ENTITY_KIND_INDICATOR, entityId, fields)
  },
}

export const createIndicatorServerTool: EntityServerTool = {
  name: 'create_indicator',
  execute(args, context) {
    return buildCreateEntityReviewResult(ENTITY_KIND_INDICATOR, args, context)
  },
}

export const editIndicatorServerTool: EntityServerTool = {
  name: 'edit_indicator',
  execute(args, context) {
    return buildUpdateEntityReviewResult(ENTITY_KIND_INDICATOR, 'edit_indicator', args, context)
  },
}

export const renameIndicatorServerTool: EntityServerTool = {
  name: 'rename_indicator',
  execute(args, context) {
    return buildUpdateEntityReviewResult(ENTITY_KIND_INDICATOR, 'rename_indicator', args, context)
  },
}

export function acceptIndicatorDocumentReview(
  toolName: string,
  result: unknown,
  context: Parameters<typeof acceptEntityDocumentReview>[0]['context']
) {
  return acceptEntityDocumentReview({
    kind: ENTITY_KIND_INDICATOR,
    toolName,
    result,
    context,
    create: createIndicatorEntity,
  })
}
