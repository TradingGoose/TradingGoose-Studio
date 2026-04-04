const SOLID_HEX_COLOR_PATTERN = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function normalizeSolidHexColor(value: string): string {
  const trimmed = value.trim()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`

  if (withHash.length === 4) {
    return `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`.toUpperCase()
  }

  return withHash.toUpperCase()
}

export function sanitizeSolidIconColor(value?: string): string | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed || !SOLID_HEX_COLOR_PATTERN.test(trimmed)) {
    return undefined
  }

  return normalizeSolidHexColor(trimmed)
}
