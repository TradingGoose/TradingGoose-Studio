import type { SubBlockCondition } from '@/blocks/types'
import { getMaxTemperature, MODEL_CONTROL_GETTERS } from '@/providers/ai/models'

/** Matches literal capabilities and keeps valid unresolved model references editable. */
function matchesConditionValue(condition: SubBlockCondition, value: unknown): boolean {
  const normalized = value && typeof value === 'object' && 'id' in value ? value.id : value
  const fieldValue = normalized === undefined ? '' : normalized
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

/** Evaluates a field condition and its nested AND dependencies with lazy controller values. */
export function evaluateSubBlockCondition(
  condition: boolean | SubBlockCondition | (() => SubBlockCondition) | undefined,
  getFieldValue: (field: string) => unknown
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
    matchesConditionValue(actualCondition, getFieldValue(actualCondition.field)) &&
    andConditions.every((entry) => evaluateSubBlockCondition(entry, getFieldValue))
  )
}

/** Evaluates a condition against the configured values used by the editor and validation. */
export function evaluateSubBlockConditionValues(
  condition: boolean | SubBlockCondition | (() => SubBlockCondition) | undefined,
  values: Record<string, unknown>
): boolean {
  return evaluateSubBlockCondition(condition, (field) => values[field])
}
