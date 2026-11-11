import { Agent } from '@mastra/core/agent'
import { createLogger } from '@/lib/logs/console/logger'
import { safeInferenceError } from '@/lib/mastra/errors'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { prepareModelRequest } from '@/lib/mastra/request'
import { assertNativeCompletion, withInferenceFacts } from '@/lib/mastra/result'
import { generateRouterPrompt } from '@/blocks/blocks/router'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import { watchExecutionCancellation } from '@/executor/handlers/agent/cancellation'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('RouterBlockHandler')

/**
 * Handler for Router blocks that dynamically select execution paths.
 */
export class RouterBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.ROUTER
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const targetBlocks = this.getTargetBlocks(block, context)

    const model = inputs.model
    if (!model) throw new Error('Model is required')
    assertListedModel(model)

    const runId = crypto.randomUUID()
    let work: Awaited<ReturnType<typeof prepareModelRequest>> | undefined
    const cancellation = watchExecutionCancellation(context.shouldCancelExecution)
    try {
      await cancellation.check()
      work = await prepareModelRequest(
        {
          model,
          actorUserId: context.userId,
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          runId,
          purpose: 'workflow-router',
          executionId: context.executionId,
          signal: cancellation.signal,
        },
        { apiKey: inputs.apiKey, modelSettings: { temperature: inputs.temperature } }
      )
      const agent = new Agent({
        ...NATIVE_AGENT_POLICY,
        id: block.id,
        name: 'Workflow Router',
        instructions: generateRouterPrompt(inputs.prompt, targetBlocks),
        model: work.model,
        mastra: work.mastra,
      })
      const native = await agent.generate([{ role: 'user', content: inputs.prompt }], work.options)
      assertNativeCompletion(native)
      await work.usage.verifyComplete()
      const accounting = work.accounting()
      cancellation.signal.throwIfAborted()
      const result = { content: native.text, model, ...accounting }

      const chosenBlockId = result.content.trim().toLowerCase()
      const chosenBlock = targetBlocks?.find((b) => b.id === chosenBlockId)

      if (!chosenBlock) {
        logger.error(
          `Invalid routing decision. Response content: "${result.content}", available blocks:`,
          targetBlocks?.map((b) => ({ id: b.id, title: b.title })) || []
        )
        throw new Error(`Invalid routing decision: ${chosenBlockId}`)
      }

      return withInferenceFacts(
        {
          prompt: inputs.prompt,
          model: result.model,
          tokens: result.tokens,
          cost: result.cost,
          selectedPath: {
            blockId: chosenBlock.id,
            blockType: chosenBlock.type || 'unknown',
            blockTitle: chosenBlock.title || 'Untitled Block',
          },
        },
        { model, ...accounting, generatedFields: ['model', 'tokens', 'cost'] }
      )
    } catch (error) {
      logger.error('Router execution failed:', safeInferenceError(error, inputs.apiKey))
      const failure = new Error(safeInferenceError(error, inputs.apiKey))
      const facts = { model, ...work?.accounting() }
      Object.assign(failure, facts)
      throw withInferenceFacts(failure, { ...facts, generatedFields: Object.keys(facts) })
    } finally {
      cancellation.stop()
    }
  }

  /**
   * Gets all potential target blocks for this router.
   *
   * @param block - Router block
   * @param context - Current execution context
   * @returns Array of potential target blocks with metadata
   * @throws Error if target block not found
   */
  private getTargetBlocks(block: SerializedBlock, context: ExecutionContext) {
    return context.workflow?.connections
      .filter((conn) => conn.source === block.id)
      .map((conn) => {
        const targetBlock = context.workflow?.blocks.find((b) => b.id === conn.target)
        if (!targetBlock) {
          throw new Error(`Target block ${conn.target} not found`)
        }

        return {
          id: targetBlock.id,
          type: targetBlock.metadata?.id,
          title: targetBlock.metadata?.name,
          description: targetBlock.metadata?.description,
          subBlocks: targetBlock.config.params,
          currentState: context.blockStates.get(targetBlock.id)?.output,
        }
      })
  }
}
