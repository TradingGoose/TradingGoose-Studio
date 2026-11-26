import { THINKING_LEVEL_VALUES } from '@mastra/code-sdk/thinking'
import { z } from 'zod'

const level = z.enum(THINKING_LEVEL_VALUES).exclude(['off'])

export const reasoningEffortSchema = z.strictObject({ type: z.literal('effort'), value: level })
export type Reasoning = z.infer<typeof reasoningEffortSchema>

export const reasoningOptionSchema = z.object({
  type: z.literal('effort'),
  values: z.array(level).nonempty(),
})
export type ReasoningOption = z.infer<typeof reasoningOptionSchema>

export function workflowReasoning(value: unknown): Reasoning | undefined {
  if (value == null || value === '') return undefined
  return reasoningEffortSchema.parse({ type: 'effort', value })
}

export function reasoningSelectionError(
  model: string,
  options: ReasoningOption[] | undefined,
  value: unknown,
  required = true
) {
  const levels = options?.[0]?.values
  if (value != null && value !== '') {
    if (!levels?.some((level) => level === value))
      return `Selected reasoning level is unsupported for ${model}`
  } else if (required && levels?.length) return `Select a reasoning level for ${model}`
}
