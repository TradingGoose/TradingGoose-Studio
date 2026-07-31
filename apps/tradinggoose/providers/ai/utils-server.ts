import { isHosted } from '@/lib/environment'
import type { ProviderRequest } from '@/providers/ai/types'
import { useProvidersStore } from '@/stores/providers/store'
import { executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'

export async function executeProviderTool(
  request: ProviderRequest,
  toolId: string,
  params: Record<string, any>,
  skipPostProcess = false
): Promise<ToolResponse> {
  const operation = await request.beginToolOperation?.(toolId)
  let identityPublished = false
  let terminalObserved = false
  const runtime = operation
    ? {
        ...operation.runtime,
        publishOperationIdentity: async (
          identity: Parameters<NonNullable<typeof operation.runtime.publishOperationIdentity>>[0]
        ) => {
          identityPublished = true
          await operation.runtime.publishOperationIdentity?.(identity)
        },
        recordTerminalObservation: async (
          state: 'canceled' | 'completed' | 'failed',
          observation?: Record<string, unknown>
        ) => {
          terminalObserved = true
          await operation.runtime.recordTerminalObservation?.(state, observation)
        },
      }
    : { signal: request.abortSignal }

  try {
    const result = await executeTool(toolId, params, skipPostProcess, undefined, runtime)
    if (operation && !terminalObserved && !identityPublished) {
      await operation.finish(result.success ? 'completed' : 'failed')
    }
    return result
  } catch (error) {
    if (operation && !terminalObserved) {
      if (request.abortSignal?.aborted) {
        await operation.finish('local_abort')
      } else if (!identityPublished) {
        await operation.finish('failed')
      }
    }
    throw error
  }
}

/**
 * Get an API key for a specific provider, handling rotation and fallbacks.
 * Server-only helper.
 */
export async function getApiKey(
  provider: string,
  model: string,
  userProvidedKey?: string
): Promise<string> {
  const hasUserKey = !!userProvidedKey
  const isOllamaModel =
    provider === 'ollama' || useProvidersStore.getState().providers.ollama.models.includes(model)

  if (isOllamaModel) {
    return 'empty'
  }

  const isOpenAIModel = provider === 'openai'
  const isClaudeModel = provider === 'anthropic'

  if (isHosted && (isOpenAIModel || isClaudeModel)) {
    try {
      const { getRotatingApiKey } = require('@/lib/utils-server')
      return await getRotatingApiKey(provider)
    } catch (_error) {
      if (hasUserKey) {
        return userProvidedKey!
      }

      throw new Error(`No API key available for ${provider} ${model}`)
    }
  }

  if (!hasUserKey) {
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  return userProvidedKey!
}
