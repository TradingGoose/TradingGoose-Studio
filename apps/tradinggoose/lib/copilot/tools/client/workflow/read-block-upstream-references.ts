import { GitBranch, Loader2, X, XCircle } from 'lucide-react'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { CopilotTool } from '@/lib/copilot/registry'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  computeBlockOutputReferences,
  getSubflowInsideOutputReferences,
  getSubflowOutsideOutputReferences,
  readWorkflowSubBlockValues,
  readWorkflowVariableOutputs,
} from '@/lib/copilot/tools/client/workflow/block-output-utils'
import { getReadableWorkflowState } from '@/lib/copilot/tools/client/workflow/workflow-review-tool-utils'
import {
  ReadBlockUpstreamReferencesResult,
  type ReadBlockUpstreamReferencesResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import type { Loop, Parallel } from '@/stores/workflows/workflow/types'

const logger = createLogger('ReadBlockUpstreamReferencesClientTool')

interface ReadBlockUpstreamReferencesArgs {
  blockIds: string[]
  workflowId: string
}

export class ReadBlockUpstreamReferencesClientTool extends BaseClientTool {
  static readonly id = CopilotTool.read_block_upstream_references

  constructor(toolCallId: string) {
    super(
      toolCallId,
      ReadBlockUpstreamReferencesClientTool.id,
      ReadBlockUpstreamReferencesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting upstream references', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting upstream references', icon: GitBranch },
      [ClientToolCallState.executing]: { text: 'Getting upstream references', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted getting references', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Retrieved upstream references', icon: GitBranch },
      [ClientToolCallState.error]: { text: 'Failed to get references', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped getting references', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const blockIds = params?.blockIds
      if (blockIds && Array.isArray(blockIds) && blockIds.length > 0) {
        const count = blockIds.length
        switch (state) {
          case ClientToolCallState.success:
            return `Retrieved references for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Getting references for ${count} block${count > 1 ? 's' : ''}`
          case ClientToolCallState.error:
            return `Failed to get references for ${count} block${count > 1 ? 's' : ''}`
        }
      }
      return undefined
    },
  }

  async execute(args?: ReadBlockUpstreamReferencesArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)
      const executionContext = this.requireExecutionContext()

      if (!args?.blockIds || args.blockIds.length === 0) {
        await this.markToolComplete(400, 'blockIds array is required')
        this.setState(ClientToolCallState.error)
        return
      }

      const {
        workflowId: activeWorkflowId,
        workflowState: snapshot,
        variables,
      } = await getReadableWorkflowState(executionContext, args.workflowId)
      const blocks = snapshot.blocks || {}
      const edges = snapshot.edges || []
      const loops = snapshot.loops || {}
      const parallels = snapshot.parallels || {}
      const subBlockValues = readWorkflowSubBlockValues(activeWorkflowId, snapshot)

      const ctx = { blocks, loops, parallels, subBlockValues }
      const variableOutputs = readWorkflowVariableOutputs(variables)
      const graphEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))

      const results: ReadBlockUpstreamReferencesResultType['results'] = []

      for (const blockId of args.blockIds) {
        const targetBlock = blocks[blockId]
        if (!targetBlock) {
          logger.warn(`Block ${blockId} not found`)
          continue
        }

        const insideSubflows: { blockId: string; blockName: string; blockType: string }[] = []
        const containingLoopIds = new Set<string>()
        const containingParallelIds = new Set<string>()

        Object.values(loops as Record<string, Loop>).forEach((loop) => {
          if (loop?.nodes?.includes(blockId)) {
            containingLoopIds.add(loop.id)
            const loopBlock = blocks[loop.id]
            if (loopBlock) {
              insideSubflows.push({
                blockId: loop.id,
                blockName: loopBlock.name || loopBlock.type,
                blockType: 'loop',
              })
            }
          }
        })

        Object.values(parallels as Record<string, Parallel>).forEach((parallel) => {
          if (parallel?.nodes?.includes(blockId)) {
            containingParallelIds.add(parallel.id)
            const parallelBlock = blocks[parallel.id]
            if (parallelBlock) {
              insideSubflows.push({
                blockId: parallel.id,
                blockName: parallelBlock.name || parallelBlock.type,
                blockType: 'parallel',
              })
            }
          }
        })

        const ancestorIds = BlockPathCalculator.findAllPathNodes(graphEdges, blockId)
        const accessibleIds = new Set<string>(ancestorIds)
        accessibleIds.add(blockId)

        containingLoopIds.forEach((loopId) => {
          accessibleIds.add(loopId)
          loops[loopId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
        })

        containingParallelIds.forEach((parallelId) => {
          accessibleIds.add(parallelId)
          parallels[parallelId]?.nodes?.forEach((nodeId) => accessibleIds.add(nodeId))
        })

        const accessibleBlocks: ReadBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'] =
          []

        for (const accessibleBlockId of accessibleIds) {
          const block = blocks[accessibleBlockId]
          if (!block?.type) continue

          const canSelfReference = block.type === 'approval' || block.type === 'human_in_the_loop'
          if (accessibleBlockId === blockId && !canSelfReference) continue

          const blockName = block.name || block.type
          let accessContext: 'inside' | 'outside' | undefined
          let outputs: ReadBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'][0]['outputs']

          if (block.type === 'loop' || block.type === 'parallel') {
            const isInside =
              (block.type === 'loop' && containingLoopIds.has(accessibleBlockId)) ||
              (block.type === 'parallel' && containingParallelIds.has(accessibleBlockId))

            accessContext = isInside ? 'inside' : 'outside'
            outputs = isInside
              ? getSubflowInsideOutputReferences(
                  block.type,
                  accessibleBlockId,
                  blockName,
                  loops,
                  parallels
                )
              : getSubflowOutsideOutputReferences(blockName)
          } else {
            outputs = computeBlockOutputReferences(block, ctx, variableOutputs)
          }

          const entry: ReadBlockUpstreamReferencesResultType['results'][0]['accessibleBlocks'][0] =
            {
              blockId: accessibleBlockId,
              blockName,
              blockType: block.type,
              outputs,
            }

          if (accessContext) entry.accessContext = accessContext
          accessibleBlocks.push(entry)
        }

        const resultEntry: ReadBlockUpstreamReferencesResultType['results'][0] = {
          blockId,
          blockName: targetBlock.name || targetBlock.type,
          accessibleBlocks,
          variables: variableOutputs,
        }

        if (insideSubflows.length > 0) resultEntry.insideSubflows = insideSubflows
        results.push(resultEntry)
      }

      const result = ReadBlockUpstreamReferencesResult.parse({ results })

      logger.info('Retrieved upstream references', {
        blockIds: args.blockIds,
        resultCount: results.length,
      })

      await this.markToolComplete(200, 'Retrieved upstream references', result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error in tool execution', { toolCallId: this.toolCallId, error, message })
      await this.markToolComplete(500, message || 'Failed to get upstream references')
      this.setState(ClientToolCallState.error)
    }
  }
}
