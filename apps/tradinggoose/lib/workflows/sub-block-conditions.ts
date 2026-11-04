import type { SubBlockCondition } from '@/blocks/types'
import { getMaxTemperature, getProviderModels, MODEL_CONTROL_GETTERS } from '@/providers/ai/models'

function matchesConditionValue(
  condition: SubBlockCondition,
  value: unknown,
  deferUnavailableModelCapabilities: boolean
): boolean {
  const normalized = value && typeof value === 'object' && 'id' in value ? value.id : value
  const fieldValue = normalized === undefined ? '' : normalized
  // Execution discovers OpenRouter capabilities later, before sanitizing the provider request.
  if (
    deferUnavailableModelCapabilities &&
    (condition.operator === 'modelCapability' || condition.operator === 'modelMaxTemperature') &&
    typeof fieldValue === 'string' &&
    fieldValue.startsWith('openrouter/') &&
    !getProviderModels('openrouter').includes(fieldValue)
  ) {
    return true
  }
  const matches =
    condition.operator === 'modelCapability'
      ? typeof fieldValue === 'string' &&
        Boolean(MODEL_CONTROL_GETTERS[condition.value](fieldValue)?.length)
      : condition.operator === 'modelMaxTemperature'
        ? typeof fieldValue === 'string' && getMaxTemperature(fieldValue) === condition.value
        : Array.isArray(condition.value)
          ? condition.value.includes(fieldValue as string | number | boolean)
          : fieldValue === condition.value

  return condition.not ? !matches : matches
}

export function evaluateSubBlockCondition(
  condition: boolean | SubBlockCondition | (() => SubBlockCondition) | undefined,
  getFieldValue: (field: string) => unknown,
  { deferUnavailableModelCapabilities = false } = {}
): boolean {
  if (typeof condition === 'boolean') return condition
  if (!condition) return true

  const actualCondition = typeof condition === 'function' ? condition() : condition
  const andConditions = Array.isArray(actualCondition.and)
    ? actualCondition.and
    : actualCondition.and
      ? [actualCondition.and]
      : []

  return (
    matchesConditionValue(
      actualCondition,
      getFieldValue(actualCondition.field),
      deferUnavailableModelCapabilities
    ) &&
    andConditions.every((entry) =>
      evaluateSubBlockCondition(entry, getFieldValue, { deferUnavailableModelCapabilities })
    )
  )
}

export function evaluateSubBlockConditionValues(
  condition: boolean | SubBlockCondition | (() => SubBlockCondition) | undefined,
  values: Record<string, unknown>
): boolean {
  return evaluateSubBlockCondition(condition, (field) => values[field])
}
