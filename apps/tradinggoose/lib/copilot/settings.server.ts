import { providers } from '@opencode-ai/models/snapshot'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import { getReasoningOptions } from '@/lib/mastra/native-reasoning'
import { getModelProviders } from '@/lib/mastra/providers'
import { type Reasoning, reasoningSelectionError } from '@/lib/mastra/reasoning'
import { isLanguageModel } from '@/lib/mastra/registry'
import { getCopilotSettings } from '@/lib/system-settings/service'
import { NativeTargetError } from './native/errors'
import { type CopilotModelOption, getCopilotModelId } from './settings'

export async function validateCopilotModel(
  modelId?: string,
  reasoning?: Reasoning,
  requireSelection = true
) {
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
  const error = reasoningSelectionError(
    selected,
    getReasoningOptions(selected),
    reasoning?.value,
    requireSelection
  )
  if (error) throw new NativeTargetError(error, 422)
  return selected
}

export async function resolveCopilotModel(modelId?: string, reasoning?: Reasoning) {
  const selected = await validateCopilotModel(modelId, reasoning, false)
  try {
    return await resolveConfiguredModel(selected)
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
