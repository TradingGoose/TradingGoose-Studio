import type { SubBlockCondition } from '@/blocks/types'

const normalizeConditionValue = (value: unknown) =>
  value && typeof value === 'object' && 'id' in value ? value.id : value

function matchesConditionValue(condition: SubBlockCondition, rawFieldValue: unknown): boolean {
  const fieldValue = normalizeConditionValue(rawFieldValue)
  const matches = Array.isArray(condition.value)
    ? condition.value.includes(fieldValue as string | number | boolean)
    : fieldValue === condition.value

  return condition.not ? !matches : matches
}

export function evaluateSubBlockCondition(
  condition: SubBlockCondition | (() => SubBlockCondition) | undefined,
  getFieldValue: (field: string) => unknown
): boolean {
  if (!condition) return true

  const actualCondition = typeof condition === 'function' ? condition() : condition
  const andConditions = Array.isArray(actualCondition.and)
    ? actualCondition.and
    : actualCondition.and
      ? [actualCondition.and]
      : []

  return (
    matchesConditionValue(actualCondition, getFieldValue(actualCondition.field)) &&
    andConditions.every((entry) => matchesConditionValue(entry, getFieldValue(entry.field)))
  )
}

export function evaluateSubBlockConditionValues(
  condition: SubBlockCondition | (() => SubBlockCondition) | undefined,
  values: Record<string, unknown>
): boolean {
  return evaluateSubBlockCondition(condition, (field) => values[field])
}
