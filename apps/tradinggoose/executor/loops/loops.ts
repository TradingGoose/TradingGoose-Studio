import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type { ExecutionContext } from '@/executor/types'
import { ConnectionUtils } from '@/executor/utils/connections'
import type { SerializedLoop } from '@/serializer/types'

const logger = createLogger('LoopManager')

/**
 * Manages loop detection, iteration limits, and state resets.
 */
export class LoopManager {
  constructor(private loops: Record<string, SerializedLoop>) {}

  /**
   * Processes all loops and checks if any need to be iterated.
   * This is called after each execution layer to handle loop iterations.
   *
   * @param context - Current execution context
   * @returns Whether any loop has reached its maximum iterations
   */
  async processLoopIterations(context: ExecutionContext): Promise<boolean> {
    let hasLoopReachedMaxIterations = false

    // Nothing to do if no loops
    if (Object.keys(this.loops).length === 0) return hasLoopReachedMaxIterations

    // Check each loop to see if it should iterate
    for (const [loopId, loop] of Object.entries(this.loops)) {
      // Skip if this loop has already been marked as completed
      if (context.completedLoops.has(loopId)) {
        continue
      }

      // Check if the loop block itself has been executed
      const loopBlockExecuted = context.executedBlocks.has(loopId)
      if (!loopBlockExecuted) {
        // Loop block hasn't been executed yet, skip processing
        continue
      }

      // Check if all blocks in the loop have been executed
      const allBlocksInLoopExecuted = this.allReachableBlocksExecuted(loop.nodes, context)

      if (allBlocksInLoopExecuted) {
        // All blocks in the loop have been executed
        const currentIteration = context.loopIterations.get(loopId)!

        // Determine the maximum iterations
        let maxIterations = loop.iterations

        // For forEach loops, use the actual items length
        if (loop.loopType === 'forEach') {
          const storedItems = context.loopItems.get(`${loopId}_items`)
          if (!storedItems) throw new Error(`Evaluated items not found for loop ${loopId}`)
          maxIterations = Array.isArray(storedItems)
            ? storedItems.length
            : Object.keys(storedItems).length
        } else if (loop.loopType === 'while' || loop.loopType === 'doWhile') {
          // For while and doWhile loops, no max iteration limit
          // They rely on the condition to stop (and workflow timeout as safety)
          maxIterations = Number.MAX_SAFE_INTEGER
        }

        logger.info(`Loop ${loopId} - Current: ${currentIteration}, Max: ${maxIterations}`)

        // Check if we've completed all iterations (only for for/forEach loops)
        if (
          currentIteration >= maxIterations &&
          (loop.loopType === 'for' || loop.loopType === 'forEach')
        ) {
          hasLoopReachedMaxIterations = true
          // Retain the last evaluated bound and children until the handler publishes completion.
          context.activeExecutionPath.add(loopId)
        } else {
          // Condition-driven loops reset their children after the next condition passes.
          if (loop.loopType === 'for' || loop.loopType === 'forEach') {
            this.resetLoopBlocks(loop, context)
          }
          context.blockStates.delete(loopId)
        }
        context.loopIterations.set(loopId, currentIteration + 1)
        context.executedBlocks.delete(loopId)
      }
    }

    return hasLoopReachedMaxIterations
  }

  /**
   * Helper method to check if all reachable blocks have been executed.
   * Separated for clarity and potential future testing.
   */
  private allReachableBlocksExecuted(nodeIds: string[], context: ExecutionContext): boolean {
    // Get all connections within the loop
    const loopConnections =
      context.workflow?.connections.filter(
        (conn) => nodeIds.includes(conn.source) && nodeIds.includes(conn.target)
      ) || []

    // Build a map of blocks to their outgoing connections within the loop
    const blockOutgoingConnections = new Map<string, typeof loopConnections>()
    for (const nodeId of nodeIds) {
      const outgoingConnections = ConnectionUtils.getOutgoingConnections(nodeId, loopConnections)
      blockOutgoingConnections.set(nodeId, outgoingConnections)
    }

    // Find blocks that have no incoming connections within the loop (entry points)
    // Only consider blocks as entry points if they have external connections to the loop
    const entryBlocks = nodeIds.filter((nodeId) =>
      ConnectionUtils.isEntryPoint(nodeId, nodeIds, context.workflow?.connections || [])
    )

    // Track which blocks we've visited and determined are reachable
    const reachableBlocks = new Set<string>()
    const toVisit = [...entryBlocks]

    // Traverse the graph to find all reachable blocks
    while (toVisit.length > 0) {
      const currentBlockId = toVisit.shift()!

      // Skip if already visited
      if (reachableBlocks.has(currentBlockId)) continue

      reachableBlocks.add(currentBlockId)

      // Get the block
      const block = context.workflow?.blocks.find((b) => b.id === currentBlockId)
      if (!block) continue

      // Get outgoing connections from this block
      const outgoing = blockOutgoingConnections.get(currentBlockId) || []

      // Handle routing blocks specially
      if (block.metadata?.id === BlockType.ROUTER) {
        // For router blocks, only follow the selected path
        const selectedTarget = context.decisions.router.get(currentBlockId)
        if (selectedTarget && nodeIds.includes(selectedTarget)) {
          toVisit.push(selectedTarget)
        }
      } else if (block.metadata?.id === BlockType.CONDITION) {
        // For condition blocks, only follow the selected condition path
        const selectedOption = context.decisions.condition.get(currentBlockId)
        if (selectedOption) {
          const selectedConnection = outgoing.find(
            (conn) => conn.sourceHandle === `condition-${selectedOption}`
          )
          if (selectedConnection?.target) {
            toVisit.push(selectedConnection.target)
          }
        }
      } else {
        // For regular blocks, use the extracted error handling method
        this.handleErrorConnections(currentBlockId, outgoing, context, toVisit)
      }
    }

    // Now check if all reachable blocks have been executed
    for (const reachableBlockId of reachableBlocks) {
      if (!context.executedBlocks.has(reachableBlockId)) {
        logger.info(
          `Loop iteration not complete - block ${reachableBlockId} is reachable but not executed`
        )
        return false
      }
    }

    logger.info(
      `All reachable blocks in loop have been executed. Reachable: ${Array.from(reachableBlocks).join(', ')}`
    )
    return true
  }

  /**
   * Resets all blocks within a loop for the next iteration.
   *
   * @param loop - The loop configuration
   * @param context - Current execution context
   */
  private resetLoopBlocks(loop: SerializedLoop, context: ExecutionContext): void {
    // Reset all blocks in the loop
    for (const nodeId of loop.nodes) {
      context.executedBlocks.delete(nodeId)

      context.blockStates.delete(nodeId)

      context.activeExecutionPath.delete(nodeId)

      context.decisions.router.delete(nodeId)
      context.decisions.condition.delete(nodeId)
    }
  }

  /**
   * Stores the result of a loop iteration.
   */
  storeIterationResult(
    context: ExecutionContext,
    loopId: string,
    iterationIndex: number,
    output: any
  ): void {
    const loop = this.loops[loopId]
    if (!loop) throw new Error(`Loop configuration not found for block ${loopId}`)
    if (loop.loopType !== 'for' && loop.loopType !== 'forEach') return

    context.loopExecutions ??= new Map()

    let loopResults = context.loopExecutions.get(loopId)
    if (!loopResults) {
      loopResults = new Map()
      context.loopExecutions.set(loopId, loopResults)
    }

    const iterationKey = `iteration_${iterationIndex}`
    const existingResult = loopResults.get(iterationKey)

    if (existingResult) {
      if (Array.isArray(existingResult)) {
        existingResult.push(output)
      } else {
        loopResults.set(iterationKey, [existingResult, output])
      }
    } else {
      loopResults.set(iterationKey, output)
    }
  }

  /**
   * Handles error connections and follows appropriate paths based on error state.
   *
   * @param blockId - ID of the block to check for error handling
   * @param outgoing - Outgoing connections from the block
   * @param context - Current execution context
   * @param toVisit - Array to add next blocks to visit
   */
  private handleErrorConnections(
    blockId: string,
    outgoing: any[],
    context: ExecutionContext,
    toVisit: string[]
  ): void {
    // For regular blocks, check if they had an error
    const blockState = context.blockStates.get(blockId)
    const hasError = blockState?.output?.error !== undefined

    // Follow appropriate connections based on error state
    for (const conn of outgoing) {
      if (conn.sourceHandle === 'error' && hasError) {
        toVisit.push(conn.target)
      } else if ((conn.sourceHandle === 'source' || !conn.sourceHandle) && !hasError) {
        toVisit.push(conn.target)
      }
    }
  }
}
