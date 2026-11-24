import {
  assertModelUsageAllowed,
  beginWorkflowModelUsage,
  type ModelUsageScope,
  recordModelUsage,
} from '@/lib/billing/model-usage'
import { createConfiguredLanguageModel } from './connections'
import { nativeReasoningSettings } from './native-reasoning'
import { prepareNativeModelRequest } from './native-request'
import { trustedModelSettings } from './options'
import { calculateNativeCost } from './pricing'
import { getMastra } from './runtime'
import { sumNativeUsage } from './usage'
import type { NativeUsageAccounting } from './usage-processors'

/** All native inference uses the same Studio admission, pricing and usage ledger. */
export function createModelUsageAccounting(scope: ModelUsageScope): NativeUsageAccounting {
  return {
    assertAllowed: () => assertModelUsageAllowed(scope),
    begin: (attemptId) => beginWorkflowModelUsage(scope, attemptId),
    async record(usage, providerMetadata, attemptId) {
      const cost = await calculateNativeCost(scope.model, usage, providerMetadata)
      return recordModelUsage(scope, sumNativeUsage([{ usage }]), cost, attemptId)
    },
  }
}

/** Resolve current Studio credentials, then use the shared native request implementation. */
export async function prepareModelRequest(
  scope: Omit<ModelUsageScope, 'actorUserId'> & { actorUserId?: string },
  settings: {
    apiKey?: string
    maxSteps?: number
    modelSettings?: unknown
    reasoning?: import('./reasoning').Reasoning
    forceTool?: boolean
  } = {}
) {
  if (!scope.actorUserId) throw new Error('An authenticated model actor is required')
  const apiKey = settings.apiKey?.trim() || undefined
  const actorScope: ModelUsageScope = {
    ...scope,
    actorUserId: scope.actorUserId,
    funding: apiKey ? scope.funding : 'account',
  }
  const mastra = await getMastra()
  const model = await createConfiguredLanguageModel(scope.model, apiKey)
  const prepared = await prepareNativeModelRequest(actorScope, {
    ...settings,
    model,
    reasoning:
      settings.reasoning &&
      nativeReasoningSettings(
        scope.model,
        settings.reasoning,
        trustedModelSettings(settings.modelSettings)?.maxOutputTokens,
        settings.forceTool
      ),
    accounting: createModelUsageAccounting(actorScope),
  })
  return { ...prepared, mastra }
}
