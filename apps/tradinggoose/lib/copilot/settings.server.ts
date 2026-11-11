import { providers } from '@opencode-ai/models/snapshot'
import { getSystemServiceDefinition } from '@/lib/system-services/catalog'
import { resolveSystemServiceConfig } from '@/lib/system-services/service'
import { getResolvedSystemSettings } from '@/lib/system-settings/service'
import { NativeTargetError } from './native/errors'
import { type CopilotModelOption, type CopilotSettings, getCopilotModelId } from './settings'

export async function getCopilotSettings(): Promise<CopilotSettings> {
  return (await getResolvedSystemSettings()).copilot
}

export async function resolveCopilotModel(
  modelId?: string
): Promise<{ model: string; apiKey: string }> {
  const settings = await getCopilotSettings()
  if (!settings.models.length || !settings.defaultModel) {
    throw new NativeTargetError('Copilot models have not been configured by a system admin', 409)
  }
  const selected = modelId ?? settings.defaultModel
  const row = settings.models.find((candidate) => getCopilotModelId(candidate) === selected)
  if (!row) {
    throw new NativeTargetError('The selected Copilot model is no longer available', 422)
  }
  const provider = getSystemServiceDefinition(row.provider)
  const credential = provider?.credentialFields[0]
  if (!provider || !credential)
    throw new NativeTargetError('The selected Copilot provider is not available', 409)
  const config = await resolveSystemServiceConfig(row.provider)
  const apiKey = config[credential.key]
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new NativeTargetError(
      'The system API key for the selected Copilot model is not configured',
      409
    )
  }
  return { model: selected, apiKey: apiKey.trim() }
}

export async function getPublicCopilotModels(): Promise<{
  models: CopilotModelOption[]
  defaultModel: string | null
}> {
  const settings = await getCopilotSettings()
  return {
    models: settings.models.map((row) => {
      const id = getCopilotModelId(row)
      return {
        id,
        label:
          providers[row.provider]?.models[row.model]?.canonical_model_id ??
          (row.model.includes('/') ? row.model : id),
      }
    }),
    defaultModel: settings.defaultModel,
  }
}
