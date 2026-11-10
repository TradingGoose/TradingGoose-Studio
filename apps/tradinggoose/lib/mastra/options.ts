import type { AgentExecutionOptions } from '@mastra/core/agent'
import { ModelRouterLanguageModel } from '@mastra/core/llm'

type PrepareStepFunction = NonNullable<AgentExecutionOptions['prepareStep']>

export const NATIVE_AGENT_POLICY = {
  maxRetries: 0,
  maxProcessorRetries: 0,
  errorProcessorDefaults: false,
  errorProcessors: [],
  defaultOptions: { errorProcessors: [], eagerToolExecution: false },
}

function plain(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.get === undefined
    )
  )
}

const MODEL_SETTINGS = new Set([
  'temperature',
  'maxOutputTokens',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'stopSequences',
  'seed',
  'reasoning',
  'maxRetries',
])

/** Product sampling controls never carry transport, model, hooks, or execution policy. */
export function trustedModelSettings(value?: unknown): AgentExecutionOptions['modelSettings'] {
  if (value === undefined) return { maxRetries: 0 }
  if (!plain(value)) throw new Error('Model Settings must be a plain object of generation controls')
  for (const key of Object.keys(value)) {
    if (!MODEL_SETTINGS.has(key) || (key === 'maxRetries' && value[key] !== 0))
      throw new Error(`Model setting ${key} is controlled by the server`)
  }
  return { ...value, maxRetries: 0 }
}

const ALLOWED_PROVIDER_FIELDS = new Set([
  'reasoningEffort',
  'reasoningSummary',
  'reasoning',
  'thinking',
  'sendReasoning',
  'textVerbosity',
  'verbosity',
  'strictJsonSchema',
  'structuredOutputs',
  'responseFormat',
  'logprobs',
  'topLogprobs',
  'logitBias',
  'user',
  'store',
  'cacheControl',
  'promptCacheKey',
  'promptCacheRetention',
  'serviceTier',
  'safetyIdentifier',
  'prediction',
  'audio',
  'modalities',
  'useSearchGrounding',
  'useDynamicRetrieval',
  'cachedContent',
  'mediaResolution',
  'safetySettings',
  'responseModalities',
  'thinkingConfig',
  'disableParallelToolUse',
  'effort',
  'budgetTokens',
  'includeReasoning',
  'reasoningFormat',
])
const RESERVED =
  /^(?:model|models|fallbacks?|provider|route|routing|messages|prompt|input|stream|tools|tool_choice|toolChoice|parallel_tool_calls|url|baseURL|baseUrl|endpoint|apiKey|api_key|headers|fetch|transport|websocket|retries|maxRetries|streamRetries|errorProcessors|prepareStep|extraBody|extraHeaders|body|options|defaultOptions)$/i

/** Reject before native resume extraction can strip these fields or bypass schema validation. */
export function assertNativeToolArguments(value: unknown): void {
  let args = value
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      throw new Error('Tool arguments must contain valid JSON')
    }
  }
  if (!plain(args)) throw new Error('Tool arguments must be a plain business object')
  if (
    ['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background'].some(
      (key) => key in args
    )
  )
    throw new Error('Native execution fields cannot be model-authored tool arguments')
}

export function trustedProviderOptions(value?: string | Record<string, unknown>) {
  if (value === undefined || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('Provider Options must contain valid JSON')
    }
  }
  if (!plain(parsed))
    throw new Error('Provider Options must be a plain object keyed by native provider namespace')
  const result: Record<string, Record<string, any>> = {}
  for (const [namespace, options] of Object.entries(parsed)) {
    if (!/^[a-z][a-z0-9-]*$/.test(namespace) || !plain(options))
      throw new Error('Provider Options must contain plain native provider namespace objects')
    for (const key of Object.keys(options)) {
      if (RESERVED.test(key) || !ALLOWED_PROVIDER_FIELDS.has(key))
        throw new Error(
          `Provider option ${namespace}.${key} is controlled by the server or unsupported`
        )
    }
    result[namespace] = structuredClone(options)
  }
  return result
}

/** Final trusted preparation composes Force/reasoning without permitting a model substitution. */
export function trustedPrepareStep(
  admittedModel: Parameters<PrepareStepFunction>[0]['model'],
  prepare?: PrepareStepFunction
): PrepareStepFunction {
  return async (step) => {
    // Routers retain the server-owned connection by identity. Core can adapt other public
    // drivers; their documented provider/model identity survives that adaptation.
    const sameModel =
      admittedModel instanceof ModelRouterLanguageModel
        ? step.model === admittedModel
        : typeof admittedModel === 'string' || typeof step.model === 'string'
          ? step.model === admittedModel
          : 'provider' in admittedModel &&
            'provider' in step.model &&
            admittedModel.provider === step.model.provider &&
            'modelId' in admittedModel &&
            'modelId' in step.model &&
            admittedModel.modelId === step.model.modelId
    if (!sameModel) throw new Error('Native model does not match the admitted selection')
    const prepared = await prepare?.(step)
    if (
      prepared?.model !== undefined ||
      (prepared?.modelSettings?.maxRetries !== undefined &&
        prepared.modelSettings.maxRetries !== 0) ||
      (step.modelSettings?.maxRetries !== undefined && step.modelSettings.maxRetries !== 0)
    )
      throw new Error('Native model and retry policy cannot be replaced')
    return {
      ...prepared,
      modelSettings: { ...step.modelSettings, ...prepared?.modelSettings, maxRetries: 0 },
      providerOptions: {
        ...step.providerOptions,
        ...prepared?.providerOptions,
        openai: {
          ...step.providerOptions?.openai,
          ...prepared?.providerOptions?.openai,
          transport: 'fetch',
        },
        azure: {
          ...step.providerOptions?.azure,
          ...prepared?.providerOptions?.azure,
          transport: 'fetch',
        },
        openrouter: {
          ...step.providerOptions?.openrouter,
          ...prepared?.providerOptions?.openrouter,
          provider: { allow_fallbacks: false },
        },
      },
    }
  }
}
