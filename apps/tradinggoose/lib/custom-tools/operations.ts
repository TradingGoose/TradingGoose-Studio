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

/**
 * Create or update custom tools scoped to a workspace.
 */
export async function upsertCustomTools({
  tools,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: UpsertCustomToolsParams) {
  return await db.transaction(async (tx) => {
    for (const tool of tools) {
      const nowTime = new Date()

      if (tool.id) {
        const existingTool = await tx
          .select()
          .from(customTools)
          .where(and(eq(customTools.id, tool.id), eq(customTools.workspaceId, workspaceId)))
          .limit(1)

        if (existingTool.length > 0) {
          await tx
            .update(customTools)
            .set({
              title: tool.title,
              schema: tool.schema,
              code: tool.code,
              updatedAt: nowTime,
            })
            .where(eq(customTools.id, tool.id))

          logger.info(`[${requestId}] Updated custom tool ${tool.id}`)
          continue
        }
      }

      const duplicateTitle = await tx
        .select()
        .from(customTools)
        .where(and(eq(customTools.workspaceId, workspaceId), eq(customTools.title, tool.title)))
        .limit(1)

      if (duplicateTitle.length > 0) {
        throw new Error(`A tool with the title "${tool.title}" already exists in this workspace`)
      }

      await tx.insert(customTools).values({
        id: tool.id || nanoid(),
        workspaceId,
        userId,
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      logger.info(`[${requestId}] Created custom tool ${tool.title}`)
    }

    return await tx
      .select()
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .orderBy(desc(customTools.createdAt))
  })
}

export async function importCustomTools({
  tools,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: ImportCustomToolsParams) {
  return await db.transaction(async (tx) => {
    const existingTools = await tx
      .select({
        title: customTools.title,
        schema: customTools.schema,
      })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))

    const usedTitles = new Set(existingTools.map((tool) => tool.title))
    const usedFunctionNames = new Set(
      existingTools
        .map((tool) =>
          tool.schema &&
          typeof tool.schema === 'object' &&
          'function' in tool.schema &&
          tool.schema.function &&
          typeof tool.schema.function === 'object' &&
          'name' in tool.schema.function &&
          typeof tool.schema.function.name === 'string'
            ? tool.schema.function.name
            : ''
        )
        .filter((name): name is string => name.length > 0)
    )

    const { tools: resolvedTools, renamedCount } = resolveImportedCustomTools({
      customTools: tools,
      usedTitles,
      usedFunctionNames,
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
}
