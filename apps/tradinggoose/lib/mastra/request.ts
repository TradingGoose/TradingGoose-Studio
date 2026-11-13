import type { AgentExecutionOptions } from '@mastra/core/agent'
import { createConfiguredLanguageModel } from './connections'
import { parseProviderOptions, trustedModelSettings } from './options'
import { getMastra } from './runtime'
import { resultAccounting } from './usage'
import { usageProcessors } from './usage-processors'

/** One request-owned model and Studio usage ledger through native Mastra execution. */
export async function prepareModelRequest(
  scope: Parameters<typeof usageProcessors>[0],
  settings: {
    apiKey?: string
    maxSteps?: number
    modelSettings?: unknown
    providerOptions?: string | Record<string, unknown>
  } = {}
) {
  const modelSettings = trustedModelSettings(settings.modelSettings)
  const providerOptions = parseProviderOptions(settings.providerOptions)
  const maxSteps = settings.maxSteps ?? 5
  const mastra = await getMastra()
  const usage = await usageProcessors(scope)
  const model = await createConfiguredLanguageModel(scope.model, settings.apiKey)
  const options = {
    runId: scope.runId,
    savePerStep: true,
    abortSignal: scope.signal,
    inputProcessors: usage.inputProcessors,
    outputProcessors: usage.outputProcessors,
    modelSettings,
    providerOptions,
    maxSteps,
    prepareStep: ({ stepNumber, systemMessages }) =>
      stepNumber >= maxSteps - 1
        ? {
            toolChoice: 'none',
            activeTools: [],
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
  return {
    model,
    usage,
    options,
    accounting: () => resultAccounting(usage.getUsage(), usage.getCost()),
    mastra,
  }
}
