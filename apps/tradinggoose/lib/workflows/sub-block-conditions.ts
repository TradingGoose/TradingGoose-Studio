import type { RegistryModel } from '@/lib/mastra/registry'
import type { SubBlockCondition } from '@/blocks/types'
import { getRegistryModel } from '@/stores/model-registry'
import { extractEnvironmentReferences, extractReferencePrefixes } from './references'

/** Matches literal capabilities and keeps valid unresolved model references editable. */
function matchesConditionValue(
  condition: SubBlockCondition,
  value: unknown,
  getModel: (id: string) => RegistryModel | undefined
): boolean {
  const normalized = value && typeof value === 'object' && 'id' in value ? value.id : value
  const fieldValue = normalized === undefined ? '' : normalized
  const capability =
    typeof fieldValue === 'string'
      ? condition.value === 'temperature'
        ? getModel(fieldValue)?.temperature
        : condition.value === 'reasoning'
          ? getModel(fieldValue)?.reasoning
          : getModel(fieldValue)?.reasoning?.flatMap((option) =>
              option.type === 'effort' ? option.values : []
            )
      : undefined
  const matches =
    condition.operator === 'modelCapability'
      ? typeof fieldValue === 'string' &&
        Boolean(fieldValue) &&
        ((Array.isArray(capability) ? capability.length > 0 : capability !== false) ||
          extractReferencePrefixes(fieldValue).some(({ raw }) =>
            raw
              .slice(1, -1)
              .split('.')
              .every((segment) => segment.trim().length > 0)
          ) ||
          extractEnvironmentReferences(fieldValue).some((reference) =>
            /^[^{}]+$/.test(reference.slice(2, -2).trim())
          ))
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
