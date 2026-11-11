import type { InputProcessor, OutputProcessor } from '@mastra/core/processors'
import {
  assertModelUsageAllowed,
  type ModelUsageScope,
  recordModelUsage,
} from '@/lib/billing/model-usage'
import { assertNativeToolArguments } from './options'
import { type NativeUsage, selectNativeUsage, sumNativeUsage } from './usage'

/** Native model steps use Studio's existing admission and usage ledger. */
export async function usageProcessors(
  scope: Omit<ModelUsageScope, 'actorUserId'> & { actorUserId?: string }
) {
  if (!scope.actorUserId) throw new Error('An authenticated model actor is required')
  const actorScope: ModelUsageScope = { ...scope, actorUserId: scope.actorUserId }
  const steps = new Map<string, NativeUsage>()
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
          const usage = selectNativeUsage(args.usage)
          steps.set(key, usage)
          await recordModelUsage(actorScope, usage)
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
    getUsage: () => sumNativeUsage([...steps.values()].map((usage) => ({ usage }))),
    async verifyComplete() {
      if (failure) throw failure
      scope.signal?.throwIfAborted()
      if (!steps.size) throw new Error('Model generation has no completed steps')
    },
  }
}
