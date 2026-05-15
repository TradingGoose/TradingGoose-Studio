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
