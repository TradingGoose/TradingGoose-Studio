import { providers } from '@opencode-ai/models/snapshot'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import { isLanguageModel } from '@/lib/mastra/registry'
import { getCopilotSettings } from '@/lib/system-settings/service'
import { NativeTargetError } from './native/errors'
import { type CopilotModelOption, getCopilotModelId } from './settings'

export async function resolveCopilotModel(
  modelId?: string
): Promise<{ model: string; apiKey?: string }> {
  const settings = await getCopilotSettings()
  const first = settings.models[0]
  if (!first) {
    throw new NativeTargetError('Copilot models have not been configured by a system admin', 409)
  }
  const selected = modelId ?? getCopilotModelId(first)
  const row = settings.models.find((candidate) => getCopilotModelId(candidate) === selected)
  if (!row || !isLanguageModel(row.provider, row.model)) {
    throw new NativeTargetError('The selected Copilot model is no longer available', 422)
  }
  try {
    const { apiKey } = await resolveConfiguredModel(selected)
    return { model: selected, apiKey: apiKey || undefined }
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
  const models = settings.models
    .filter((row) => isLanguageModel(row.provider, row.model))
    .map((row) => {
      const id = getCopilotModelId(row)
      return {
        id,
        label:
          providers[row.provider]?.models?.[row.model]?.canonical_model_id ??
          (row.model.includes('/') ? row.model : id),
      }
    })
  return { models }
}
