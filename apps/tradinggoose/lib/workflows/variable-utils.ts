import type { Variable } from '@/stores/variables/types'

/**
 * Normalize an unknown value into a `Record<string, Variable>`.
 * Returns an empty record for null, undefined, arrays or non-objects.
 */
export function normalizeVariables(
  variables: unknown
): Record<string, Variable> {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return {}
  }

  return variables as Record<string, Variable>
}
