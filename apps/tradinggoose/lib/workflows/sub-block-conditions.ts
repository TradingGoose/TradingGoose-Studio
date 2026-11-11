import type { RegistryModel } from '@/lib/mastra/registry'
import type { SubBlockCondition } from '@/blocks/types'
import { getRegistryModel } from '@/stores/model-registry'

/** Native metadata disables known unsupported controls; unknown model support stays editable. */
function matchesConditionValue(
  condition: SubBlockCondition,
  value: unknown,
  getModel: (id: string) => RegistryModel | undefined
): boolean {
  const normalized = value && typeof value === 'object' && 'id' in value ? value.id : value
  const fieldValue = normalized === undefined ? '' : normalized
  const matches =
    condition.operator === 'modelCapability'
      ? typeof fieldValue === 'string' &&
        Boolean(fieldValue) &&
        getModel(fieldValue)?.[condition.value] !== false
      : Array.isArray(condition.value)
        ? condition.value.includes(fieldValue as string | number | boolean)
        : fieldValue === condition.value

  return condition.not ? !matches : matches
}

/** Evaluates a field condition and its nested AND dependencies with lazy controller values. */
export function evaluateSubBlockCondition(
  condition: boolean | SubBlockCondition | (() => SubBlockCondition) | undefined,
  getFieldValue: (field: string) => unknown,
  getModel: (id: string) => RegistryModel | undefined = getRegistryModel
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
    matchesConditionValue(actualCondition, getFieldValue(actualCondition.field), getModel) &&
    andConditions.every((entry) => evaluateSubBlockCondition(entry, getFieldValue, getModel))
  )
}

/** Evaluates a condition against the configured values used by the editor and validation. */
export function evaluateSubBlockConditionValues(
  condition: boolean | SubBlockCondition | (() => SubBlockCondition) | undefined,
  values: Record<string, unknown>
): boolean {
  return evaluateSubBlockCondition(condition, (field) => values[field])
}
