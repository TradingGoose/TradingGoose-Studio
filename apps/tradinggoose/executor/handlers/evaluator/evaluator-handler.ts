import { Agent } from '@mastra/core/agent'
import { toStandardSchema } from '@mastra/core/schema'
import { safeInferenceError } from '@/lib/mastra/errors'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { assertListedModel } from '@/lib/mastra/registry'
import { prepareModelRequest } from '@/lib/mastra/request'
import { assertNativeCompletion, withInferenceFacts } from '@/lib/mastra/result'
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
    await assertListedModel(model)
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
          purpose: 'workflow-evaluator',
          funding: inputs.apiKey ? 'byok' : 'account',
          executionId: context.executionId,
          signal: cancellation.signal,
        },
        { apiKey: inputs.apiKey, modelSettings: { temperature: inputs.temperature } }
      )
      const agent = new Agent({
        ...NATIVE_AGENT_POLICY,
        id: block.id,
        name: 'Workflow Evaluator',
        instructions,
        model: work.model,
        mastra: work.mastra,
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
          ...work.options,
          structuredOutput: {
            schema: toStandardSchema(schema),
            errorStrategy: 'strict',
            jsonPromptInjection: true,
          },
        }
      )
      assertNativeCompletion(result)
      await work.usage.verifyComplete()
      const accounting = work.accounting()
      cancellation.signal.throwIfAborted()
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
      const facts = { model, ...work?.accounting() }
      Object.assign(failure, facts)
      throw withInferenceFacts(failure, { ...facts, generatedFields: Object.keys(facts) })
    } finally {
      cancellation.stop()
    }
  }
}
