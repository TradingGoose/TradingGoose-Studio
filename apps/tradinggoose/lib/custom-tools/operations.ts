import { db } from '@tradinggoose/db'
import { customTools } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  type CustomToolTransferRecord,
  resolveImportedCustomTools,
} from '@/lib/custom-tools/import-export'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { readSavedEntityListFieldsForExecution } from '@/lib/yjs/server/bootstrap-review-target'
import type { EntityListBeforeInsert } from '@/lib/yjs/server/entity-loaders'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'

const logger = createLogger('CustomToolsOperations')

interface CreateCustomToolsParams {
  tools: Array<{
    title: string
    schema: Record<string, any>
    code: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
  beforeInsert?: EntityListBeforeInsert
}

interface ImportCustomToolsParams {
  tools: CustomToolTransferRecord[]
  workspaceId: string
  userId: string
  requestId?: string
}

export async function listCustomTools(params: { workspaceId: string }) {
  const entries = await readSavedEntityListFieldsForExecution(
    'custom_tool',
    params.workspaceId,
    false
  )
  return entries.map(({ entityId, entityName, fields }) => ({
    id: entityId,
    workspaceId: params.workspaceId,
    userId: null,
    title: entityName,
    schema: parseCustomToolSchemaText(fields.schemaText),
    code: String(fields.codeText ?? ''),
  }))
}

export async function createCustomTools({
  tools,
  workspaceId,
  userId,
  requestId = generateRequestId(),
  beforeInsert,
}: CreateCustomToolsParams) {
  if (tools.length === 0) {
    return []
  }

  const created = await db.transaction(async (tx) => {
    await beforeInsert?.(tx)
    const existingTools = await tx
      .select({
        id: customTools.id,
        title: customTools.title,
      })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))

    const plannedTitles = new Map(existingTools.map((tool) => [tool.title, tool.id]))
    const nowTime = new Date()
    const insertValues = []

    for (const tool of tools) {
      const conflictingToolId = plannedTitles.get(tool.title)

      if (conflictingToolId) {
        throw new Error(`A tool with the title "${tool.title}" already exists in this workspace`)
      }

      const toolId = nanoid()
      plannedTitles.set(tool.title, toolId)
      insertValues.push({
        id: toolId,
        workspaceId,
        userId,
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
        createdAt: nowTime,
        updatedAt: nowTime,
      })
    }

    const createdTools = await tx.insert(customTools).values(insertValues).returning()
    return createdTools
  })

  await refreshEntityListSession('custom_tool', workspaceId)
  logger.info(`[${requestId}] Created ${created.length} custom tool(s)`)
  return created
}

export async function importCustomTools({
  tools,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: ImportCustomToolsParams) {
  const result = await db.transaction(async (tx) => {
    const existingTools = await tx
      .select({
        title: customTools.title,
      })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))

    const usedTitles = new Set(existingTools.map((tool) => tool.title))

    const { tools: resolvedTools, renamedCount } = resolveImportedCustomTools({
      customTools: tools,
      usedTitles,
    })

    const nowTime = new Date()
    const importValues = resolvedTools.map((tool) => ({
      id: nanoid(),
      workspaceId,
      userId,
      title: tool.title,
      schema: tool.schema,
      code: tool.code,
      createdAt: nowTime,
      updatedAt: nowTime,
    }))

    const importedTools = await tx.insert(customTools).values(importValues).returning()

    return {
      tools: importedTools,
      importedCount: importedTools.length,
      renamedCount,
    }
  })

  await refreshEntityListSession('custom_tool', workspaceId)
  logger.info(`[${requestId}] Imported ${result.tools.length} custom tool(s)`, {
    workspaceId,
    renamedCount: result.renamedCount,
  })
  return result
}
