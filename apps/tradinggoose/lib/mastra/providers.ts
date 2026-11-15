import { validateDownloadUrl } from '@ai-sdk/provider-utils'
import { GatewayRegistry } from '@mastra/core/llm'

/** Studio supports native remote providers; local servers and deployment-specific URLs are unsupported. */
export function getModelProviders() {
  return Object.fromEntries(
    Object.entries(GatewayRegistry.getInstance().getProviders()).filter(([, provider]) => {
      if (provider.gateway !== 'models.dev' || provider.url?.includes('${')) return false
      if (provider.url === undefined) return true // Native adapters supply their own endpoints.
      if (!provider.url.startsWith('https://')) return false
      try {
        validateDownloadUrl(provider.url)
        return true
      } catch {
        return false
      }
    })
  )
}
