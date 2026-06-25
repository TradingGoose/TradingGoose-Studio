import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { desc, eq } from 'drizzle-orm'
import { ENTITY_KIND_INDICATOR } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { createIndicators } from '@/lib/indicators/custom/operations'
import {
  DEFAULT_INDICATOR_RUNTIME_ENTRIES,
  DEFAULT_INDICATOR_RUNTIME_MAP,
} from '@/lib/indicators/default/runtime'
import { normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import {
  buildDocumentEnvelope,
  type CopilotIndicatorListEntry,
  type EntityCreateResult,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
  readSavedEntityDocumentFields,
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
  row: typeof pineIndicators.$inferSelect
): CopilotIndicatorListEntry {
  const inputMeta = normalizeInputMetaMap(row.inputMeta)
  const inputTitles = Object.keys(inputMeta ?? {})

  return {
    name: row.name,
    source: 'custom',
    editable: true,
    callableInFunctionBlock: true,
    ...(inputTitles.length > 0 ? { inputTitles } : {}),
    entityId: row.id,
    runtimeId: row.id,
  }
}

async function listCopilotIndicators(workspaceId: string): Promise<CopilotIndicatorListEntry[]> {
  const defaultOptions = DEFAULT_INDICATOR_RUNTIME_ENTRIES.map(toDefaultIndicatorListEntry)
  const customRows = await db
    .select()
    .from(pineIndicators)
    .where(eq(pineIndicators.workspaceId, workspaceId))
    .orderBy(desc(pineIndicators.createdAt))
  const customOptions = customRows.map(toCustomIndicatorListEntry)

  return [...defaultOptions, ...customOptions].sort((a, b) => a.name.localeCompare(b.name))
}

async function createIndicatorEntity(
  fields: Record<string, unknown>,
  context: Parameters<typeof verifyWorkspaceContext>[0]
): Promise<EntityCreateResult> {
  const { userId, workspaceId } = await verifyWorkspaceContext(context, 'write')
  const rows = await createIndicators({
    userId,
    workspaceId,
    indicators: [
      {
        name: String(fields.name ?? ''),
        color: String(fields.color ?? ''),
        pineCode: String(fields.pineCode ?? ''),
        inputMeta:
          fields.inputMeta &&
          typeof fields.inputMeta === 'object' &&
          !Array.isArray(fields.inputMeta)
            ? (fields.inputMeta as Record<string, unknown>)
            : undefined,
      },
    ],
  })
  const row = rows[0]
  if (!row) {
    throw new Error('Created indicator was not returned')
  }

  return {
    entityId: row.id,
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
      const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(runtimeId)
      if (defaultIndicator) {
        return buildDocumentEnvelope(ENTITY_KIND_INDICATOR, undefined, {
          name: defaultIndicator.name,
          color: '',
          pineCode: defaultIndicator.pineCode,
          inputMeta: defaultIndicator.inputMeta ?? null,
        })
      }

      const { workspaceId } = await verifySavedEntityContext(
        context,
        ENTITY_KIND_INDICATOR,
        runtimeId,
        'read'
      )
      const fields = await readSavedEntityDocumentFields(
        ENTITY_KIND_INDICATOR,
        runtimeId,
        workspaceId
      )
      return buildDocumentEnvelope(ENTITY_KIND_INDICATOR, runtimeId, fields)
    }

    const entityId = requireEntityId(args, 'read_indicator')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_INDICATOR,
      entityId,
      'read'
    )
    const fields = await readSavedEntityDocumentFields(ENTITY_KIND_INDICATOR, entityId, workspaceId)
    return buildDocumentEnvelope(ENTITY_KIND_INDICATOR, entityId, fields)
  },
}

export const createIndicatorServerTool: EntityServerTool = {
  name: 'create_indicator',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_INDICATOR,
      args,
      context,
      createIndicatorEntity
    )
  },
}

export const editIndicatorServerTool: EntityServerTool = {
  name: 'edit_indicator',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_INDICATOR,
      'edit_indicator',
      args,
      context
    )
  },
}

export const renameIndicatorServerTool: EntityServerTool = {
  name: 'rename_indicator',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_INDICATOR,
      'rename_indicator',
      args,
      context
    )
  },
}
