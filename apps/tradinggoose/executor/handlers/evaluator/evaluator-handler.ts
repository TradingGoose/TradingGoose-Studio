import { Agent } from '@mastra/core/agent'
import { toStandardSchema } from '@mastra/core/schema'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { safeInferenceError } from '@/lib/mastra/errors'
import { NATIVE_AGENT_POLICY, trustedModelSettings } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { assertNativeCompletion, withInferenceFacts } from '@/lib/mastra/result'
import { getMastra } from '@/lib/mastra/runtime'
import { resultAccounting, selectNativeUsage, sumNativeUsage } from '@/lib/mastra/usage'
import { usageProcessors } from '@/lib/mastra/usage-processors'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import { watchExecutionCancellation } from '@/executor/handlers/agent/cancellation'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

/** Evaluates content with native schema validation and direct metric output fields. */
export class EvaluatorBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.EVALUATOR
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    const model = inputs.model
    if (!model) throw new Error('Model is required')
    assertListedModel(model)
    const metrics = (Array.isArray(inputs.metrics) ? inputs.metrics : []).filter(
      (metric: any) => metric?.name && metric.range
    )
    const properties = Object.fromEntries(
      metrics.map((metric: any) => [
        metric.name.toLowerCase(),
        { type: 'number', minimum: metric.range.min, maximum: metric.range.max },
      ])
    )
    const schema = {
      type: 'object' as const,
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    }
    const instructions = `Evaluate the content against these metrics and return scores as a JSON object.
${metrics.map((metric: any) => `${metric.name} (${metric.range.min}-${metric.range.max}): ${metric.description || ''}`).join('\n')}`
    const mastra = await getMastra()
    const startedAt = new Date()
    const runId = crypto.randomUUID()
    const steps: Array<{
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    }> = []
    let returnedUsage: Parameters<typeof resultAccounting>[0]
    let accounting: Awaited<ReturnType<typeof resultAccounting>> | undefined
    let finance: Awaited<ReturnType<typeof usageProcessors>> | undefined
    const capture = () =>
      resultAccounting(selectNativeUsage(returnedUsage, finance?.getUsage(), sumNativeUsage(steps)))
    const cancellation = watchExecutionCancellation(context.shouldCancelExecution)
    try {
      await cancellation.check()
      finance = await usageProcessors({
        actorUserId: context.userId,
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        runId,
        purpose: 'workflow-evaluator',
        signal: cancellation.signal,
      })
      const admittedModel = createConfiguredLanguageModel(model, inputs.apiKey)
      const agent = new Agent({
        inputProcessors: finance.inputProcessors,
        outputProcessors: finance.outputProcessors,
        ...NATIVE_AGENT_POLICY,
        id: block.id,
        name: 'Workflow Evaluator',
        instructions,
        model: admittedModel,
        mastra,
      })

      const result = await agent.generate(
        [
          {
            role: 'user',
            content:
              typeof inputs.content === 'string'
                ? inputs.content
                : JSON.stringify(inputs.content ?? ''),
          },
        ],
        {
          runId,
          onStepFinish: (step) => {
            steps.push(step)
          },
          modelSettings: trustedModelSettings({ temperature: inputs.temperature }),
          maxProcessorRetries: 0,
          structuredOutput: { schema: toStandardSchema(schema), errorStrategy: 'strict' },
          abortSignal: cancellation.signal,
          tracingOptions: {
            metadata: { userId: context.userId, resourceId: context.workspaceId, runId },
          },
        }
      )
      // Snapshot only validated public counts before completion/financial checks can reject.
      returnedUsage = selectNativeUsage(result.totalUsage)
      assertNativeCompletion(result)
      await finance.verifyComplete()
      accounting = await capture()
      cancellation.signal.throwIfAborted()
      if (result.finishReason === 'aborted' || result.finishReason === 'error') {
        throw new Error(`Evaluator generation ${result.finishReason}`)
      }
      if (!result.object || typeof result.object !== 'object' || Array.isArray(result.object)) {
        throw new Error('Evaluator requires a valid structured result')
      }
      const business = result.object as Record<string, number>
      const facts = { model, ...accounting }
      return withInferenceFacts(
        { content: inputs.content, ...facts, ...business },
        {
          ...facts,
          generatedFields: Object.keys(facts).filter((key) => !Object.hasOwn(business, key)),
        }
      )
    } catch (error) {
      const failure = new Error(safeInferenceError(error, inputs.apiKey))
      const facts = { model, ...(accounting ?? (await capture())) }
      Object.assign(failure, facts)
      throw withInferenceFacts(failure, { ...facts, generatedFields: Object.keys(facts) })
    } finally {
      cancellation.stop()
    }
  }
}
