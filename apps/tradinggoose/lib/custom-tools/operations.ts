import { db } from '@tradinggoose/db'
import { customTools } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  type CustomToolTransferRecord,
  resolveImportedCustomTools,
} from '@/lib/custom-tools/import-export'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { syncSavedEntityRowsToYjs } from '@/lib/yjs/entity-state'

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
  const createdRows: Array<typeof customTools.$inferSelect> = []
  const updatedRows: Array<typeof customTools.$inferSelect> = []
  await db.transaction(async (tx) => {
    for (const tool of tools) {
      const nowTime = new Date()
      const duplicateTitle = await tx
        .select({ id: customTools.id })
        .from(customTools)
        .where(and(eq(customTools.workspaceId, workspaceId), eq(customTools.title, tool.title)))
        .limit(1)

      if (duplicateTitle[0] && duplicateTitle[0].id !== tool.id) {
        throw new Error(`A tool with the title "${tool.title}" already exists in this workspace`)
      }

      if (tool.id) {
        const existingTool = await tx
          .select()
          .from(customTools)
          .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
          .limit(1)

        if (existingTool.length > 0) {
          const duplicateTitle = await tx
            .select({ id: customTools.id })
            .from(customTools)
            .where(and(eq(customTools.workspaceId, workspaceId), eq(customTools.title, tool.title)))
            .limit(1)

          if (duplicateTitle.length > 0 && duplicateTitle[0].id !== tool.id) {
            throw new Error(
              `A tool with the title "${tool.title}" already exists in this workspace`
            )
          }

          const [updatedTool] = await tx
            .update(customTools)
            .set({
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
              updatedAt: nowTime,
            })
            .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
            .returning()
          if (updatedTool) {
            updatedRows.push(updatedTool)
          }
          logger.info(`[${requestId}] Updated custom tool ${tool.id}`)
          continue
        }
      }

      const toolId = tool.id || nanoid()
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
      createdRows.push(newTool)
    }
  })

  await syncSavedEntityRowsToYjs('custom_tool', [...createdRows, ...updatedRows])

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

  await syncSavedEntityRowsToYjs('custom_tool', result.tools)

  return result
}
