/**
 * Generic resolver for entity IDs from pairContext or widget params.
 *
 * When pair context is provided, linked widgets resolve only from that shared
 * context. Otherwise the value is read from local widget params.
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
  if (pairContext) {
    const value = Object.hasOwn(pairContext, key) ? pairContext[key] : null
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  const value = params?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
