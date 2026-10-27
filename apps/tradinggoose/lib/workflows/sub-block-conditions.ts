import type { SubBlockCondition } from '@/blocks/types'

function matchesConditionValue(condition: SubBlockCondition, value: unknown): boolean {
  const normalized = value && typeof value === 'object' && 'id' in value ? value.id : value
  const fieldValue = normalized === undefined ? '' : normalized
  const matches = Array.isArray(condition.value)
    ? condition.value.includes(fieldValue as string | number | boolean)
    : fieldValue === condition.value

  return condition.not ? !matches : matches
}

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

export function evaluateSubBlockConditionValues(
  condition: boolean | SubBlockCondition | (() => SubBlockCondition) | undefined,
  values: Record<string, unknown>
): boolean {
  return evaluateSubBlockCondition(condition, (field) => values[field])
}
