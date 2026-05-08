const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }

  if (isPlainRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        const nextValue = sortJsonValue(value[key])
        if (nextValue !== undefined) {
          sorted[key] = nextValue
        }
        return sorted
      }, {})
  }

  return value
}

export function stableStringifyJsonValue(value: unknown): string {
  return JSON.stringify(sortJsonValue(value) ?? null)
}
