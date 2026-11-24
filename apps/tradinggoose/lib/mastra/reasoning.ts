import type { ModelReasoningOption } from '@mastra/core/llm'
import { z } from 'zod'

export const efforts = [
  'none',
  'default',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export const reasoningSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('effort'), value: z.enum(efforts) }),
  z.strictObject({ type: z.literal('budget_tokens'), value: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('toggle'), value: z.boolean() }),
])
export type Reasoning = z.infer<typeof reasoningSchema>

export const reasoningOptionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('effort'), values: z.array(z.enum(efforts)).nonempty() }),
  z.object({
    type: z.literal('budget_tokens'),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
  z.object({ type: z.literal('toggle') }),
])

export function supportsReasoning(
  options: ModelReasoningOption[] | undefined,
  selection: Reasoning
) {
  return (
    options?.some((option) => {
      if (option.type === 'effort' && selection.type === 'effort')
        return option.values.includes(selection.value)
      if (option.type === 'budget_tokens' && selection.type === 'budget_tokens')
        return (
          Number.isSafeInteger(selection.value) &&
          selection.value >= (option.min ?? 0) &&
          selection.value <= (option.max ?? Number.POSITIVE_INFINITY)
        )
      return option.type === 'toggle' && selection.type === 'toggle'
    }) ?? false
  )
}

export function workflowReasoning(inputs: {
  reasoningMode?: unknown
  reasoningEffort?: unknown
  reasoningBudget?: unknown
  reasoningToggle?: unknown
}): Reasoning | undefined {
  const type = inputs.reasoningMode
  if (type == null || type === '' || type === 'auto') return undefined
  let value: unknown
  if (type === 'effort') value = inputs.reasoningEffort
  if (type === 'budget_tokens') {
    const budget = inputs.reasoningBudget
    value = typeof budget === 'string' && budget.trim() ? Number(budget) : budget
  }
  if (type === 'toggle') {
    const toggle = inputs.reasoningToggle
    value = toggle === 'false' ? false : toggle === 'true' ? true : toggle
  }
  return reasoningSchema.parse({ type, value })
}
