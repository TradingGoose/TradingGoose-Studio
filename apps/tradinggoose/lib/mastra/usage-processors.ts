import type { InputProcessor, OutputProcessor } from '@mastra/core/processors'
import {
  assertModelUsageAllowed,
  type ModelUsageScope,
  recordModelUsage,
} from '@/lib/billing/model-usage'
import { assertNativeToolArguments } from './options'
import {
  calculateNativeCost,
  type NativeCost,
  type NativeUsage,
  sumNativeCosts,
  sumNativeUsage,
} from './usage'

/** Native model steps use Studio's existing admission and usage ledger. */
export async function usageProcessors(
  scope: Omit<ModelUsageScope, 'actorUserId'> & { actorUserId?: string }
) {
  if (!scope.actorUserId) throw new Error('An authenticated model actor is required')
  const actorScope: ModelUsageScope = { ...scope, actorUserId: scope.actorUserId }
  const steps = new Map<string, { usage: NativeUsage; cost: NativeCost }>()
  let failure: unknown
  const input: InputProcessor = {
    id: 'studio-usage-admission',
    async processInputStep() {
      if (failure) throw failure
      try {
        await assertModelUsageAllowed(actorScope)
      } catch (error) {
        failure = error
        throw error
      }
    },
    processAPIError({ error }) {
      failure = error
    },
  }
  const output: OutputProcessor = {
    id: 'studio-usage-accounting',
    async processOutputStep(args) {
      try {
        if (failure) throw failure
        const key = `${scope.runId}:${args.stepNumber}:${args.retryCount}`
        if (!steps.has(key)) {
          const step = {
            usage: sumNativeUsage([{ usage: args.usage }]),
            cost: { status: 'unavailable' } as NativeCost,
          }
          steps.set(key, step)
          step.cost = await calculateNativeCost(scope.model, args.usage, args.providerMetadata)
          const response = args.messageList.get.response
            .db()
            .filter((message) => message.role === 'assistant')
            .at(-1)
          if (response) {
            const metadata = response.content.metadata ?? {}
            args.messageList.add(
              {
                ...response,
                content: {
                  ...response.content,
                  metadata: {
                    ...metadata,
                    usage: sumNativeUsage([
                      { usage: metadata.usage as NativeUsage | undefined },
                      step,
                    ]),
                    cost: sumNativeCosts([
                      ...(metadata.cost ? [metadata.cost as NativeCost] : []),
                      step.cost,
                    ]),
                  },
                },
              },
              'response'
            )
          }
          await recordModelUsage(actorScope, step.usage, step.cost)
        }
        if (!args.finishReason || !['stop', 'tool-calls', 'length'].includes(args.finishReason))
          throw new Error('Model step did not complete successfully')
        for (const call of args.toolCalls ?? []) assertNativeToolArguments(call.args)
        scope.signal?.throwIfAborted()
        return args.messageList
      } catch (error) {
        failure = error
        throw error
      }
    },
  }
  return {
    inputProcessors: [input],
    outputProcessors: [output],
    getUsage: () => sumNativeUsage([...steps.values()]),
    getCost: () => sumNativeCosts([...steps.values()].map((step) => step.cost)),
    async verifyComplete() {
      if (failure) throw failure
      scope.signal?.throwIfAborted()
      if (!steps.size) throw new Error('Model generation has no completed steps')
    },
  }
}
