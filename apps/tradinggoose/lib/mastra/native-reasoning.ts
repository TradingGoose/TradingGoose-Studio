import type { AgentExecutionOptions } from '@mastra/core/agent'
import {
  GatewayRegistry,
  getModelReasoningOptions,
  type ModelReasoningOption,
  type ModelRouterLanguageModel,
  parseModelString,
} from '@mastra/core/llm'
import { providers } from '@opencode-ai/models/snapshot'
import { efforts, type Reasoning, supportsReasoning } from './reasoning'

// Matches ModelsDevGateway.resolveLanguageModel, including its per-model Responses override.
function apiFor(provider: string, modelId: string) {
  const config = GatewayRegistry.getInstance().getProviders()[provider]
  const override = config?.modelOverrides?.[modelId]
  if (override?.shape === 'responses' || provider === 'openai') return 'openai.responses'
  switch (provider) {
    case 'gemini':
    case 'google':
      return 'google.generative-ai'
    case 'anthropic':
    case 'moonshotai':
    case 'moonshotai-cn':
      return 'anthropic.messages'
    case 'openrouter':
    case 'perplexity':
      return provider
    case 'xai':
      return 'xai.responses'
    case 'deepseek':
    case 'mistral':
    case 'groq':
    case 'cerebras':
    case 'togetherai':
    case 'deepinfra':
      return `${provider}.chat`
    case 'vercel':
      return 'gateway'
  }
  if (provider.includes('alibaba')) return 'alibaba.chat'
  switch (override?.npm ?? config?.npm) {
    case '@ai-sdk/anthropic':
      return 'anthropic.messages'
    case '@ai-sdk/google':
      return 'google.generative-ai'
    case '@ai-sdk/openai':
      return 'openai.chat'
    case '@ai-sdk/mistral':
      return 'mistral.chat'
  }
  return `${provider}.chat`
}

const lowToHigh = ['low', 'medium', 'high']
const allowedEfforts: Record<string, readonly string[]> = {
  'openai.responses': efforts.filter((value) => value !== 'default'),
  'openai.chat': efforts.filter((value) => value !== 'default'),
  'anthropic.messages': [...lowToHigh, 'xhigh', 'max'],
  'google.generative-ai': ['minimal', ...lowToHigh],
  openrouter: efforts.filter((value) => value !== 'default'),
  'deepseek.chat': ['low', 'high', 'max'],
  'groq.chat': ['none', 'default', ...lowToHigh],
  'mistral.chat': ['none', 'low', 'high', 'max'],
  'xai.responses': ['none', ...lowToHigh, 'xhigh'],
  'alibaba.chat': efforts.filter((value) => value !== 'default'),
  'togetherai.chat': efforts,
  'deepinfra.chat': efforts,
  'cerebras.chat': efforts,
  perplexity: ['minimal', ...lowToHigh, 'xhigh'],
}

// The installed Alibaba V4 adapter converts effort to a fraction of its fixed 16,384-token allowance.
const alibabaEffortBudgets: Record<string, number> = {
  minimal: 1024,
  low: 1638,
  medium: 4915,
  high: 9830,
  xhigh: 14746,
  max: 15565,
}

function routeFor(model: string) {
  const { provider, modelId } = parseModelString(model)
  if (!provider) throw new Error('Model must use provider/model format')
  const api = apiFor(provider, modelId)
  if (api !== 'gateway') return { api, format: api, modelId, provider }
  const nested = parseModelString(modelId)
  const format =
    nested.provider && Object.hasOwn(allowedEfforts, apiFor(nested.provider, nested.modelId))
      ? apiFor(nested.provider, nested.modelId)
      : undefined
  return { api, format, modelId: nested.modelId, provider: nested.provider ?? '' }
}

export function requestableReasoningOptions(model: string): ModelReasoningOption[] | undefined {
  const options = getModelReasoningOptions(model)
  if (!options?.length) return options
  const { api, format, modelId, provider } = routeFor(model)
  if (!format) return []
  const siliconflow = /^siliconflow(?:-cn)?\.chat$/.test(format)
  return options.flatMap((option): ModelReasoningOption[] => {
    if (option.type === 'effort') {
      if (api === 'gateway' && format === 'alibaba.chat') return []
      const levels = allowedEfforts[format] ?? efforts
      const budget = options.find((entry) => entry.type === 'budget_tokens')
      const values = option.values.filter((value) => {
        if (!levels.includes(value)) return false
        if (format !== 'alibaba.chat' || !budget || value === 'none') return true
        const tokens = alibabaEffortBudgets[value]
        return tokens >= (budget.min ?? 0) && tokens <= (budget.max ?? Number.POSITIVE_INFINITY)
      })
      return values.length ? [{ ...option, values }] : []
    }
    if (option.type === 'budget_tokens') {
      if (
        !siliconflow &&
        !['alibaba.chat', 'openrouter', 'anthropic.messages', 'google.generative-ai'].includes(
          format
        )
      )
        return []
      const min = Math.max(
        option.min ?? 0,
        format === 'anthropic.messages'
          ? 1024
          : ['alibaba.chat', 'openrouter'].includes(format)
            ? 1
            : 0
      )
      const outputLimit = providers[provider]?.models?.[modelId]?.limit.output
      const max =
        format === 'anthropic.messages' && outputLimit
          ? Math.min(option.max ?? Number.POSITIVE_INFINITY, outputLimit - 1)
          : option.max
      return max !== undefined && min > max
        ? []
        : [{ type: 'budget_tokens', min, ...(max === undefined ? {} : { max }) }]
    }
    if (format === 'google.generative-ai')
      return /gemma-4|gemini-2\.5-flash/i.test(modelId) ? [option] : []
    return siliconflow ||
      /^(?:zai|zhipuai)(?:-coding-plan)?\.chat$/.test(format) ||
      [
        'openrouter',
        'deepseek.chat',
        'anthropic.messages',
        'togetherai.chat',
        'deepinfra.chat',
        'alibaba.chat',
      ].includes(format)
      ? [option]
      : []
  })
}

type ProviderOptions = NonNullable<
  Parameters<ModelRouterLanguageModel['doGenerate']>[0]['providerOptions']
>
export type NativeReasoningSettings = Pick<AgentExecutionOptions, 'modelSettings'> & {
  api: string
  providerOptions?: ProviderOptions
}
export function nativeReasoningSettings(
  model: string,
  selection: Reasoning,
  maxOutputTokens?: number,
  forceTool?: boolean
): NativeReasoningSettings {
  const { api, format, modelId, provider } = routeFor(model)
  if (!format || !supportsReasoning(requestableReasoningOptions(model), selection))
    throw new Error(`Selected reasoning control is unsupported for ${model}`)
  const namespace = format.split('.')[0]!
  const { type, value } = selection
  const withOptions = (options: ProviderOptions[string]) => ({
    api,
    providerOptions: { [namespace]: options },
  })
  switch (format) {
    case 'openai.responses':
    case 'openai.chat':
      return withOptions({
        reasoningEffort: value,
        ...(format === 'openai.responses' ? { forceReasoning: true } : {}),
      })
    case 'anthropic.messages': {
      const adaptive = type === 'effort' && !/opus-4[.-]5/.test(modelId)
      const adaptiveToggle =
        type === 'toggle' &&
        /claude/.test(modelId) &&
        getModelReasoningOptions(model)?.some((option) => option.type === 'effort')
      // Manual thinking rejects named tools. Adaptive thinking permits them on these other models.
      if (
        forceTool &&
        (type === 'budget_tokens' ||
          (type === 'toggle' && value && !adaptiveToggle) ||
          /claude-(?:(?:sonnet|opus)-5[.-]5|(?:fable|mythos)-5[.-][12])/.test(modelId))
      )
        throw new Error('Forced tools conflict with the selected Anthropic thinking mode')
      if (type === 'effort')
        return withOptions({
          effort: value,
          ...(adaptive ? { thinking: { type: 'adaptive' } } : {}),
        })
      if (type === 'budget_tokens') {
        const limit = providers[provider]?.models?.[modelId]?.limit.output
        if (
          maxOutputTokens !== undefined &&
          (value >= maxOutputTokens || (limit && maxOutputTokens + value > limit))
        )
          throw new Error('Thinking budget conflicts with Max Output Tokens')
        return withOptions({ thinking: { type: 'enabled', budgetTokens: value } })
      }
      return withOptions({
        thinking: { type: value ? (adaptiveToggle ? 'adaptive' : 'enabled') : 'disabled' },
      })
    }
    case 'google.generative-ai':
      return withOptions({
        thinkingConfig:
          type === 'effort'
            ? { thinkingLevel: value }
            : type === 'budget_tokens'
              ? { thinkingBudget: value }
              : /gemma-4/i.test(modelId)
                ? { thinkingLevel: value ? 'high' : 'minimal' }
                : { thinkingBudget: value ? -1 : 0 },
      })
    case 'openrouter':
      if (
        modelId.startsWith('anthropic/') &&
        type === 'budget_tokens' &&
        maxOutputTokens !== undefined &&
        value >= maxOutputTokens
      )
        throw new Error('Thinking budget conflicts with Max Output Tokens')
      return withOptions({
        reasoning: {
          [type === 'toggle' ? 'enabled' : type === 'effort' ? 'effort' : 'max_tokens']: value,
        },
      })
    case 'perplexity':
      return withOptions({ reasoning: { effort: value } })
    case 'deepseek.chat':
      return withOptions({
        thinking: { type: value ? 'enabled' : 'disabled' },
        ...(type === 'effort' ? { reasoningEffort: value } : {}),
      })
    case 'alibaba.chat':
      if (
        forceTool &&
        modelId.toLowerCase().includes('qwen') &&
        value !== false &&
        value !== 'none'
      )
        throw new Error('Forced tools conflict with Qwen thinking mode')
      if (type === 'effort' && value !== 'default')
        return { api, modelSettings: { reasoning: value } }
      return withOptions(
        type === 'toggle'
          ? { enableThinking: value }
          : { enableThinking: true, thinkingBudget: value }
      )
  }
  if (namespace.startsWith('siliconflow') && type !== 'effort')
    return withOptions(
      type === 'toggle'
        ? { enable_thinking: value }
        : { enable_thinking: true, thinking_budget: value }
    )
  if ((namespace.startsWith('zai') || namespace.startsWith('zhipuai')) && type === 'toggle')
    return withOptions({ thinking: { type: value ? 'enabled' : 'disabled' } })
  return withOptions(
    type === 'toggle' ? { reasoning: { enabled: value } } : { reasoningEffort: value }
  )
}
