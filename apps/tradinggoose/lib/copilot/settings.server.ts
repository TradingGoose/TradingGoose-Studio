import { providers } from '@opencode-ai/models/snapshot'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import { getReasoningOptions } from '@/lib/mastra/native-reasoning'
import { getModelProviders } from '@/lib/mastra/providers'
import {
  type Reasoning,
  reasoningFromChoice,
  reasoningSelectionError,
} from '@/lib/mastra/reasoning'
import { isLanguageModel } from '@/lib/mastra/registry'
import { getCopilotSettings } from '@/lib/system-settings/service'
import { NativeTargetError } from './native/errors'
import { type CopilotModelOption, getCopilotModelId } from './settings'

export async function validateCopilotModel(modelId?: string, reasoning?: Reasoning) {
  const settings = await getCopilotSettings()
  const first = settings.models[0]
  if (!first) {
    throw new NativeTargetError('Copilot models have not been configured by a system admin', 409)
  }
  const selected = modelId ?? getCopilotModelId(first)
  const row = settings.models.find((candidate) => getCopilotModelId(candidate) === selected)
  if (
    !row ||
    !Object.hasOwn(getModelProviders(), row.provider) ||
    !isLanguageModel(row.provider, row.model, true)
  ) {
    throw new NativeTargetError('The selected Copilot model is no longer available', 422)
  }
  const options = getReasoningOptions(selected)
  const error = reasoningSelectionError(selected, options, reasoning?.value)
  if (error) throw new NativeTargetError(error, 422)
  return { model: selected, reasoning: reasoning ?? reasoningFromChoice(undefined, options) }
}

export async function resolveCopilotModel(modelId?: string, reasoning?: Reasoning) {
  const { model } = await validateCopilotModel(modelId, reasoning)
  try {
    return await resolveConfiguredModel(model)
  } catch {
    throw new NativeTargetError(
      'The system connection for the selected Copilot model is not configured',
      409
    )
  }
}

export async function getPublicCopilotModels(): Promise<{
  models: CopilotModelOption[]
}> {
  const settings = await getCopilotSettings()
  const available = getModelProviders()
  const models = settings.models
    .filter(
      (row) =>
        Object.hasOwn(available, row.provider) && isLanguageModel(row.provider, row.model, true)
    )
    .map((row) => {
      const id = getCopilotModelId(row)
      return {
        id,
        label:
          providers[row.provider]?.models?.[row.model]?.canonical_model_id ??
          (row.model.includes('/') ? row.model : id),
        reasoningOptions: getReasoningOptions(id),
      }
    })
  return { models }
}
