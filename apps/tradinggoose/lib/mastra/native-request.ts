import type { AgentExecutionOptions } from '@mastra/core/agent'
import type { NativeModelConnection } from './connections'
import { createNativeModel, getReasoningOptions } from './native-reasoning'
import { trustedModelSettings } from './options'
import { type Reasoning, reasoningSelectionError } from './reasoning'
import { assertNativeCompletion } from './result'
import { resultAccounting } from './usage'
import {
  type NativeUsageAccounting,
  type NativeUsageScope,
  usageProcessors,
} from './usage-processors'

/** Native request execution is independent of Studio's connection and accounting transport. */
export async function prepareNativeModelRequest(
  scope: NativeUsageScope & { model: string; workspaceId?: string | null },
  settings: {
    model: NativeModelConnection
    accounting: NativeUsageAccounting
    modelSettings?: unknown
    reasoning?: Reasoning
  }
) {
  const modelSettings = trustedModelSettings(settings.modelSettings)
  const { reasoning } = settings
  const error = reasoningSelectionError(
    scope.model,
    getReasoningOptions(scope.model),
    reasoning?.value
  )
  if (error) throw new Error(error)
  const model = await createNativeModel(settings.model, reasoning?.value)
  const usage = await usageProcessors(scope, settings.accounting)
  const options = {
    runId: scope.runId,
    savePerStep: true,
    abortSignal: scope.signal,
    inputProcessors: usage.inputProcessors,
    outputProcessors: usage.outputProcessors,
    modelSettings,
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
    model,
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
