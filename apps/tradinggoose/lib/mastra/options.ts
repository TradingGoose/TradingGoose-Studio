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
