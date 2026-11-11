import type { AgentExecutionOptions } from '@mastra/core/agent'
import { z } from 'zod'

const PROVIDER_OPTIONS = {
  openai: { transport: 'fetch' as const },
  azure: { transport: 'fetch' as const },
  openrouter: { provider: { allow_fallbacks: false } },
}

export const NATIVE_AGENT_POLICY = {
  maxRetries: 0,
  maxProcessorRetries: 0,
  errorProcessorDefaults: false,
  errorProcessors: [],
  defaultOptions: {
    errorProcessors: [],
    eagerToolExecution: false,
    modelSettings: { maxRetries: 0 },
    providerOptions: PROVIDER_OPTIONS,
  },
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

export function trustedModelSettings(value?: unknown): AgentExecutionOptions['modelSettings'] {
  const settings = z.record(z.string(), z.json().optional()).parse(value === undefined ? {} : value)
  for (const key of Object.keys(settings)) {
    if (!MODEL_SETTINGS.has(key) || (key === 'maxRetries' && settings[key] !== 0))
      throw new Error(`Model setting ${key} is controlled by the server`)
  }
  return { ...settings, maxRetries: 0 }
}

/** Mastra reserves these root arguments for resuming tools. */
export function assertNativeToolArguments(value: unknown): void {
  const args = z
    .record(z.string(), z.json())
    .parse(typeof value === 'string' ? JSON.parse(value) : value)
  if (
    ['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background'].some(
      (key) => key in args
    )
  )
    throw new Error('Native execution fields cannot be model-authored tool arguments')
}

const RESERVED =
  /^(?:model|models|fallbacks?|provider|route|routing|messages|prompt|input|stream|tools|tool_choice|toolChoice|parallel_tool_calls|url|baseURL|baseUrl|endpoint|apiKey|api_key|headers|fetch|transport|websocket|retries|maxRetries|streamRetries|errorProcessors|prepareStep|extraBody|extraHeaders|body|options|defaultOptions)$/i

/** Provider generation controls use native namespaces; connections remain server-owned. */
export function parseProviderOptions(value?: string | Record<string, unknown>) {
  const options = z
    .record(z.string(), z.record(z.string(), z.json()))
    .parse(
      typeof value === 'string'
        ? value.trim()
          ? JSON.parse(value)
          : {}
        : value === undefined
          ? {}
          : value
    )
  for (const [namespace, fields] of Object.entries(options)) {
    for (const key of Object.keys(fields)) {
      if (RESERVED.test(key))
        throw new Error(`Provider option ${namespace}.${key} is controlled by the server`)
    }
  }
  for (const [namespace, policy] of Object.entries(PROVIDER_OPTIONS))
    options[namespace] = { ...options[namespace], ...policy }
  return options
}
