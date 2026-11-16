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
  })
  .strict()

export function trustedModelSettings(value?: unknown): AgentExecutionOptions['modelSettings'] {
  const settings = MODEL_SETTINGS.parse(value === undefined ? {} : value)
  return Object.fromEntries(Object.entries(settings).filter(([, setting]) => setting !== undefined))
}

const executionControl =
  /(?:mcp|tools?|functions?|skills?|search|container|websocket|transport|credentials?|headers?|api_?key|authorization|url|endpoint|body|fallback|routing|retries|service_?tier)/i
const requestControl = /^(?:models?|messages?|prompts?|systemPrompt|instructions?|input|stream)$/i

/** Native namespaced JSON; provider adapters own their supported generation fields. */
export const providerOptionsSchema = z
  .record(z.string().min(1), z.record(z.string(), z.json()))
  .superRefine((options, context) => {
    const check = (value: unknown, path: string[]) => {
      if (!value || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) {
        const next = [...path, key]
        if (executionControl.test(key) || (path.length === 1 && requestControl.test(key)))
          context.addIssue({
            code: 'custom',
            path: next,
            message: 'Connections and tool execution are controlled by Studio',
          })
        check(nested, next)
      }
    }
    for (const [namespace, controls] of Object.entries(options)) check(controls, [namespace])
  })

/** Preserve native option names and values; the selected SDK validates their provider format. */
export function parseProviderOptions(value?: unknown) {
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
