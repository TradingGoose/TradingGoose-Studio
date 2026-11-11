import { resolveSystemServiceConfig } from '@/lib/system-services/service'
import { getResolvedSystemSettings } from '@/lib/system-settings/service'
import { NativeTargetError } from './native/errors'
import { COPILOT_PROVIDERS, type CopilotSettings, getCopilotModelId } from './settings'

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
  const provider = COPILOT_PROVIDERS[row.provider]
  const config = await resolveSystemServiceConfig(row.provider)
  const apiKey = config[provider.credentialKey]
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new NativeTargetError(`The Copilot API key for ${provider.name} is not configured`, 409)
  }
  return { model: selected, apiKey: apiKey.trim() }
}

export async function getPublicCopilotModels(): Promise<{
  models: string[]
  defaultModel: string | null
}> {
  const settings = await getCopilotSettings()
  return { models: settings.models.map(getCopilotModelId), defaultModel: settings.defaultModel }
}
