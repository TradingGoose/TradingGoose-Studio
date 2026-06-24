import { db } from '@tradinggoose/db'
import { customTools } from '@tradinggoose/db/schema'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  type CustomToolTransferRecord,
  resolveImportedCustomTools,
} from '@/lib/custom-tools/import-export'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { applySavedEntityPersistedState } from '@/lib/yjs/server/apply-entity-state'

const logger = createLogger('CustomToolsOperations')

interface UpsertCustomToolsParams {
  tools: Array<{
    id?: string
    title: string
    schema: Record<string, any>
    code: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
}

interface ImportCustomToolsParams {
  tools: CustomToolTransferRecord[]
  workspaceId: string
  userId: string
  requestId?: string
}

export async function listCustomTools(params: { workspaceId: string }) {
  return db
    .select()
    .from(customTools)
    .where(eq(customTools.workspaceId, params.workspaceId))
    .orderBy(desc(customTools.createdAt))
}

/**
 * Create or update custom tools scoped to a workspace.
 */
export async function upsertCustomTools({
  tools,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: UpsertCustomToolsParams) {
  const updates: Array<{
    id: string
    fields: Record<string, unknown>
  }> = []

  await db.transaction(async (tx) => {
    const existingTools = await tx
      .select({
        id: customTools.id,
        title: customTools.title,
      })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))

    const existingById = new Map(
      existingTools.map((tool) => [tool.id, { id: tool.id, title: tool.title }])
    )
    const plannedTitles = new Map(existingTools.map((tool) => [tool.title, tool.id]))

    for (const tool of tools) {
      const nowTime = new Date()
      const existingTool = tool.id ? existingById.get(tool.id) : null
      const conflictingToolId = plannedTitles.get(tool.title)

      if (conflictingToolId && conflictingToolId !== tool.id) {
        throw new Error(`A tool with the title "${tool.title}" already exists in this workspace`)
      }

      if (existingTool && tool.id) {
        if (existingTool.title !== tool.title) {
          plannedTitles.delete(existingTool.title)
          plannedTitles.set(tool.title, tool.id)
          existingTool.title = tool.title
        }

        updates.push({
          id: tool.id,
          fields: {
            title: tool.title,
            schemaText: JSON.stringify(tool.schema, null, 2),
            codeText: tool.code,
          },
        })
        logger.info(`[${requestId}] Updated custom tool ${tool.id}`)
        continue
      }

      const toolId = tool.id || nanoid()
      plannedTitles.set(tool.title, toolId)
      existingById.set(toolId, { id: toolId, title: tool.title })
      const newTool = {
        id: toolId,
        workspaceId,
        userId,
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
        createdAt: nowTime,
        updatedAt: nowTime,
      }
      await tx.insert(customTools).values(newTool)

      logger.info(`[${requestId}] Created custom tool ${tool.title}`)
    }
  })

  await Promise.all(
    updates.map(({ id, fields }) =>
      applySavedEntityPersistedState('custom_tool', id, workspaceId, fields)
    )
  )

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

  return result
}
