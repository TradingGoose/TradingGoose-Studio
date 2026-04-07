/**
 * Generic resolver for entity IDs from pairContext or widget params.
 *
 * Checks `pairContext[key]` first (when the key exists on the object), then
 * falls back to `params[key]`.  Returns `null` when the value is missing,
 * not a string, or a blank/whitespace-only string.
 */
export function resolveEntityId(
  key: string,
  {
    params,
    pairContext,
  }: {
    params?: Record<string, unknown> | null
    pairContext?: Record<string, unknown> | null
  }
): string | null {
  if (pairContext && Object.hasOwn(pairContext, key)) {
    const value = pairContext[key]
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  const value = params?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
