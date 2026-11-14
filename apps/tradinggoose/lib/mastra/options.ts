import type { AgentExecutionOptions } from '@mastra/core/agent'
import { z } from 'zod'

const numericSetting = (schema = z.number()) =>
  z.preprocess(
    (value) =>
      value == null || (typeof value === 'string' && !value.trim())
        ? undefined
        : typeof value === 'string'
          ? Number(value)
          : value,
    schema.optional()
  )

const MODEL_SETTINGS = z
  .object({
    temperature: numericSetting(),
    maxOutputTokens: numericSetting(z.number().int().min(1)),
    topP: numericSetting(),
    topK: numericSetting(),
    presencePenalty: numericSetting(),
    frequencyPenalty: numericSetting(),
    stopSequences: z.array(z.string()).optional(),
    seed: numericSetting(z.number().int()),
    reasoning: z
      .enum(['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
      .optional(),
  })
  .strict()

export function trustedModelSettings(value?: unknown): AgentExecutionOptions['modelSettings'] {
  const settings = MODEL_SETTINGS.parse(value === undefined ? {} : value)
  return Object.fromEntries(Object.entries(settings).filter(([, setting]) => setting !== undefined))
}

/** Mastra reserves these root arguments for resuming tools. */
export function parseNativeToolArguments(value: unknown) {
  const args = z
    .record(z.string(), z.json())
    .parse(typeof value === 'string' ? JSON.parse(value) : value)
  if (
    ['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background'].some(
      (key) => key in args
    )
  )
    throw new Error('Native execution fields cannot be model-authored tool arguments')
  return args
}

const RESERVED =
  /^(?:model|models|fallbacks?|provider|route|routing|messages|prompt|input|stream|tools|tool_choice|toolChoice|parallel_tool_calls|service_?tier|url|baseURL|baseUrl|endpoint|apiKey|api_key|headers|fetch|transport|websocket|retries|maxRetries|streamRetries|errorProcessors|prepareStep|extraBody|extraHeaders|body|options|defaultOptions)$/i

/** Provider generation controls use native namespaces; connections remain server-owned. */
export const providerOptionsSchema = z
  .record(z.string(), z.record(z.string(), z.json()))
  .superRefine((options, context) => {
    for (const [namespace, fields] of Object.entries(options)) {
      for (const key of Object.keys(fields)) {
        if (RESERVED.test(key))
          context.addIssue({
            code: 'custom',
            path: [namespace, key],
            message: `Provider option ${namespace}.${key} is controlled by the server`,
          })
      }
    }
  })

export function parseProviderOptions(value?: string | Record<string, unknown>) {
  return providerOptionsSchema.parse(
    typeof value === 'string'
      ? value.trim()
        ? JSON.parse(value)
        : {}
      : value === undefined
        ? {}
        : value
  )
}
