import type { AgentExecutionOptions } from '@mastra/core/agent'
import { trustedModelSettings } from './options'
import { assertNativeCompletion } from './result'
import { resultAccounting } from './usage'
import {
  type NativeUsageAccounting,
  type NativeUsageScope,
  usageProcessors,
} from './usage-processors'

/** Native request execution is independent of Studio's connection and accounting transport. */
export async function prepareNativeModelRequest<TModel>(
  scope: NativeUsageScope & { workspaceId?: string | null },
  settings: {
    model: TModel
    accounting: NativeUsageAccounting
    maxSteps?: number
    modelSettings?: unknown
  }
) {
  const modelSettings = trustedModelSettings(settings.modelSettings)
  const maxSteps = settings.maxSteps ?? 5
  const usage = await usageProcessors(scope, settings.accounting)
  const options = {
    runId: scope.runId,
    savePerStep: true,
    abortSignal: scope.signal,
    inputProcessors: usage.inputProcessors,
    outputProcessors: usage.outputProcessors,
    modelSettings,
    maxSteps,
    prepareStep: ({ stepNumber, systemMessages }) =>
      stepNumber >= maxSteps - 1
        ? {
            toolChoice: 'none',
            tools: {},
            systemMessages: [
              ...systemMessages,
              {
                role: 'system',
                content:
                  'No model steps remain after this one. Do not use tools. Give your final answer using available results; explain missing information instead of inventing it.',
              },
            ],
          }
        : {},
    tracingOptions: {
      metadata: {
        userId: scope.actorUserId,
        resourceId: scope.workspaceId ?? undefined,
        runId: scope.runId,
      },
    },
  } satisfies AgentExecutionOptions
  const accounting = () => resultAccounting(usage.getUsage(), usage.getCost())
  return {
    model: settings.model,
    usage,
    options,
    accounting,
    async complete(result: Parameters<typeof assertNativeCompletion>[0]) {
      await usage.verifyComplete()
      assertNativeCompletion(result)
      return accounting()
    },
  }
}
