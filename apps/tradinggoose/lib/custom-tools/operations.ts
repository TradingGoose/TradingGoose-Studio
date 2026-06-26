import { db } from '@tradinggoose/db'
import { customTools } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  type CustomToolTransferRecord,
  resolveImportedCustomTools,
} from '@/lib/custom-tools/import-export'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'
import { readBootstrappedSavedEntityListFields } from '@/lib/yjs/server/bootstrap-review-target'
import { notifyEntityListMembersAdded } from '@/lib/yjs/server/snapshot-bridge'

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
}

interface SaveCustomToolParams {
  tool: {
    id: string
    title: string
    schema: Record<string, any>
    code: string
  }
  workspaceId: string
  requestId?: string
}

interface ImportCustomToolsParams {
  tools: CustomToolTransferRecord[]
  workspaceId: string
  userId: string
  requestId?: string
}

export async function listCustomTools(params: { workspaceId: string }) {
  const entries = await readBootstrappedSavedEntityListFields('custom_tool', params.workspaceId)
  return entries.map(({ entityId, fields }) => ({
    id: entityId,
    workspaceId: params.workspaceId,
    userId: null,
    title: String(fields.title ?? ''),
    schema: parseCustomToolSchemaText(fields.schemaText),
    code: String(fields.codeText ?? ''),
    createdAt: new Date(0),
    updatedAt: undefined,
  }))
}

export async function createCustomTools({
  tools,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: CreateCustomToolsParams) {
  if (tools.length === 0) {
    return []
  }

  const created = await db.transaction(async (tx) => {
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
    logger.info(`[${requestId}] Created ${createdTools.length} custom tool(s)`)
    return createdTools
  })

  await notifyEntityListMembersAdded(
    'custom_tool',
    workspaceId,
    created.map((createdTool) => ({ id: createdTool.id, name: createdTool.title }))
  )
  return created
}

export async function saveCustomTool({
  tool,
  workspaceId,
  requestId = generateRequestId(),
}: SaveCustomToolParams) {
  const [existingTool] = await db
    .select({ id: customTools.id })
    .from(customTools)
    .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
    .limit(1)
  if (!existingTool) {
    throw new Error(`Custom tool ${tool.id} was not found`)
  }

  await applySavedEntityState('custom_tool', tool.id, {
    title: tool.title,
    schemaText: JSON.stringify(tool.schema, null, 2),
    codeText: tool.code,
  })
  logger.info(`[${requestId}] Saved custom tool ${tool.id}`)
  return listCustomTools({ workspaceId })
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

    logger.info(`[${requestId}] Imported ${importedTools.length} custom tool(s)`, {
      workspaceId,
      renamedCount,
    })

    return {
      tools: importedTools,
      importedCount: importedTools.length,
      renamedCount,
    }
  })

  await notifyEntityListMembersAdded(
    'custom_tool',
    workspaceId,
    result.tools.map((importedTool) => ({ id: importedTool.id, name: importedTool.title }))
  )
  return result
}
