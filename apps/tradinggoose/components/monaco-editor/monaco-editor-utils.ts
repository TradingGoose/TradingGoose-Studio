export const parsePx = (value?: string | number): number | undefined => {
  if (typeof value === 'number') return value
  if (!value) return undefined
  const trimmed = value.trim()
  if (trimmed.endsWith('px')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2))
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}
