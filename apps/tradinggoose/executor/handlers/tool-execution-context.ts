import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

export const getBlockToolExecutionId = (
  block: SerializedBlock,
  context: ExecutionContext
): string => {
  if (context.currentVirtualBlockId) return context.currentVirtualBlockId

  for (const [loopId, loop] of Object.entries(context.workflow?.loops ?? {})) {
    if (!loop.nodes.includes(block.id)) continue
    const iteration = context.loopIterations.get(loopId)
    return iteration === undefined ? block.id : `${block.id}:${loopId}:${iteration}`
  }

  return block.id
}

export const withBlockToolExecutionContext = (
  params: Record<string, any>,
  block: SerializedBlock,
  context: ExecutionContext
) => ({
  ...params,
  _context: {
    ...(params._context ?? {}),
    toolExecutionId: getBlockToolExecutionId(block, context),
  },
})

/**
 * Helper function to collect runtime block outputs and name mappings
 * for tag resolution in Agent tools and Function blocks
 */
export function collectBlockData(context: ExecutionContext): {
  blockData: Record<string, any>
  blockNameMapping: Record<string, string>
} {
  const blockData: Record<string, any> = {}
  const blockNameMapping: Record<string, string> = {}

  for (const [id, state] of context.blockStates.entries()) {
    if (state.output !== undefined) {
      blockData[id] = state.output
      const workflowBlock = context.workflow?.blocks?.find((b) => b.id === id)
      if (workflowBlock?.metadata?.name) {
        // Map both the display name and normalized form
        blockNameMapping[workflowBlock.metadata.name] = id
        const normalized = workflowBlock.metadata.name.replace(/\s+/g, '').toLowerCase()
        blockNameMapping[normalized] = id
      }
    }
  }

  return { blockData, blockNameMapping }
}
