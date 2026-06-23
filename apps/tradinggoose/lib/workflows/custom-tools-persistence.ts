import { createLogger } from '@/lib/logs/console/logger'
import { getCustomToolEntityIdFromRuntimeId } from '@/lib/custom-tools/schema'
import { upsertCustomTools } from '@/lib/custom-tools/operations'

const logger = createLogger('CustomToolsPersistence')

interface CustomTool {
  id?: string
  type: 'custom-tool'
  title: string
  toolId: string
  schema: {
    function: {
      description: string
      parameters: Record<string, any>
    }
  }
  code: string
  usageControl?: string
}

/**
 * Extract all custom tools from agent blocks in the workflow state
 */
export function extractCustomToolsFromWorkflowState(workflowState: any): CustomTool[] {
  const customToolsMap = new Map<string, CustomTool>()

  if (!workflowState?.blocks) {
    return []
  }

  for (const [blockId, block] of Object.entries(workflowState.blocks)) {
    try {
      const blockData = block as any

      // Only process agent blocks
      if (!blockData || blockData.type !== 'agent') {
        continue
      }

      const subBlocks = blockData.subBlocks || {}
      const toolsSubBlock = subBlocks.tools

      if (!toolsSubBlock?.value) {
        continue
      }

      let tools = toolsSubBlock.value

      // Parse if it's a string
      if (typeof tools === 'string') {
        try {
          tools = JSON.parse(tools)
        } catch (error) {
          logger.warn(`Failed to parse tools in block ${blockId}`, { error })
          continue
        }
      }

      if (!Array.isArray(tools)) {
        continue
      }

      // Extract custom tools
      for (const tool of tools) {
        if (
          tool &&
          typeof tool === 'object' &&
          tool.type === 'custom-tool' &&
          tool.title &&
          tool.toolId &&
          tool.schema?.function &&
          tool.code
        ) {
          const toolKey = tool.toolId

          // Deduplicate by toolKey (if same tool appears in multiple blocks)
          if (!customToolsMap.has(toolKey)) {
            customToolsMap.set(toolKey, tool as CustomTool)
          }
        }
      }
    } catch (error) {
      logger.error(`Error extracting custom tools from block ${blockId}`, { error })
    }
  }

  return Array.from(customToolsMap.values())
}

/**
 * Persist custom tools to the database
 * Creates new tools or updates existing ones
 */
export async function persistCustomToolsToDatabase(
  customToolsList: CustomTool[],
  workspaceId: string | null,
  userId: string
): Promise<{ saved: number; errors: string[] }> {
  if (!customToolsList || customToolsList.length === 0) {
    return { saved: 0, errors: [] }
  }

  if (!workspaceId) {
    logger.debug('Skipping custom tools persistence - no workspaceId provided')
    return { saved: 0, errors: [] }
  }

  const errors: string[] = []
  try {
    await upsertCustomTools({
      tools: customToolsList.map((tool) => ({
        id: normalizeToolId(tool),
        title: tool.title,
        schema: tool.schema,
        code: tool.code,
      })),
      workspaceId,
      userId,
    })

    logger.info(`Persisted ${customToolsList.length} custom tool(s)`, { workspaceId })
    return { saved: customToolsList.length, errors }
  } catch (error) {
    const errorMsg = `Failed to persist custom tools: ${error instanceof Error ? error.message : String(error)}`
    logger.error(errorMsg, { error })
    errors.push(errorMsg)
    return { saved: 0, errors }
  }
}

function normalizeToolId(tool: CustomTool): string {
  return getCustomToolEntityIdFromRuntimeId(tool.toolId)
}

/**
 * Extract and persist custom tools from workflow state in one operation
 */
export async function extractAndPersistCustomTools(
  workflowState: any,
  workspaceId: string | null,
  userId: string
): Promise<{ saved: number; errors: string[] }> {
  const customToolsList = extractCustomToolsFromWorkflowState(workflowState)

  if (customToolsList.length === 0) {
    logger.debug('No custom tools found in workflow state')
    return { saved: 0, errors: [] }
  }

  logger.info(`Found ${customToolsList.length} custom tool(s) to persist`, {
    tools: customToolsList.map((t) => t.title),
    workspaceId,
  })

  return await persistCustomToolsToDatabase(customToolsList, workspaceId, userId)
}
