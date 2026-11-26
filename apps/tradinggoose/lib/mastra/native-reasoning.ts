import { getCredentialProviderId } from '@mastra/code-sdk/providers/model-ids'
import { getAvailableThinkingLevelsForModel } from '@mastra/code-sdk/thinking'
import { getModelReasoningOptions } from '@mastra/core/llm'
import type { NativeModelConnection } from './connections'
import type { Reasoning, ReasoningOption } from './reasoning'

export function getReasoningOptions(model: string): ReasoningOption[] | undefined {
  const options = getModelReasoningOptions(model)
  if (!options) return undefined
  const values = getAvailableThinkingLevelsForModel(model, options).filter(
    (level) => level !== 'off'
  )
  return values.length ? [{ type: 'effort', values }] : []
}

export async function createNativeModel(
  connection: NativeModelConnection,
  thinkingLevel?: Reasoning['value']
) {
  const { MastraCodeGateway } = await import('@mastra/code-sdk/agents/mastracode-gateway')
  const credentialProvider = getCredentialProviderId(connection.providerId)
  const getKey = (provider: string) =>
    provider === credentialProvider ? connection.apiKey : undefined
  return new MastraCodeGateway({
    mastraGatewayBaseUrl: '',
    routeThroughMastraGateway: false,
    customProviders: [],
    thinkingLevel,
    credentialStore: {
      allowEnvironmentFallback: false,
      reload() {},
      get: () => undefined,
      getStoredApiKey: getKey,
      getApiKey: async (provider) => getKey(provider),
    },
  }).resolveLanguageModel(connection)
}
