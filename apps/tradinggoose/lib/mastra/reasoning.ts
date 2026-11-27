import { THINKING_LEVEL_VALUES } from '@mastra/code-sdk/thinking'
import { z } from 'zod'

const level = z.enum(THINKING_LEVEL_VALUES).exclude(['off'])

export const reasoningEffortSchema = z.strictObject({ type: z.literal('effort'), value: level })
export type Reasoning = z.infer<typeof reasoningEffortSchema>

export const reasoningOptionSchema = z.object({
  type: z.literal('effort'),
  values: z.array(level).nonempty(),
  defaultValue: level,
})
export type ReasoningOption = z.infer<typeof reasoningOptionSchema>

export function reasoningFromChoice(
  choice: unknown,
  options?: ReasoningOption[]
): Reasoning | undefined {
  const value = choice == null || choice === '' ? options?.[0]?.defaultValue : choice
  if (value === undefined) return undefined
  return reasoningEffortSchema.parse({ type: 'effort', value })
}

export function reasoningSelectionError(
  model: string,
  options: ReasoningOption[] | undefined,
  value: unknown
) {
  if (value != null && value !== '' && !options?.[0]?.values.some((level) => level === value))
    return `Selected reasoning level is unsupported for ${model}`
}
