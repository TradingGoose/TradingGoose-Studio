import { GatewayRegistry } from '@mastra/core/llm'

/** Studio supplies an API key; deployment-specific gateways and URL settings are unsupported. */
export function getModelProviders() {
  return Object.fromEntries(
    Object.entries(GatewayRegistry.getInstance().getProviders()).filter(
      ([, provider]) => provider.gateway === 'models.dev' && !provider.url?.includes('${')
    )
  )
}
