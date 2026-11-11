import type { AgentExecutionOptions } from '@mastra/core/agent'
import { createConfiguredLanguageModel } from './connections'
import { parseProviderOptions, trustedModelSettings } from './options'
import { getMastra } from './runtime'
import { resultAccounting } from './usage'
import { usageProcessors } from './usage-processors'

/** One request-owned model, usage ledger, and native execution policy for Studio Agents. */
export async function prepareModelRequest(
  scope: Parameters<typeof usageProcessors>[0],
  settings: {
    apiKey?: string
    modelSettings?: unknown
    providerOptions?: string | Record<string, unknown>
  } = {}
) {
  const modelSettings = trustedModelSettings(settings.modelSettings)
  const providerOptions = parseProviderOptions(settings.providerOptions)
  const mastra = await getMastra()
  const usage = await usageProcessors(scope)
  const model = createConfiguredLanguageModel(scope.model, settings.apiKey)
  const options = {
    runId: scope.runId,
    abortSignal: scope.signal,
    inputProcessors: usage.inputProcessors,
    outputProcessors: usage.outputProcessors,
    modelSettings,
    providerOptions,
    maxProcessorRetries: 0,
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
