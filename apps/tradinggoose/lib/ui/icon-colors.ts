import { getStableVibrantColor } from '@/lib/colors'

const SOLID_HEX_COLOR_PATTERN = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const DEFAULT_ENTITY_ICON_COLOR_SEED = 'entity-icon'

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

export function withIconColorAlpha(value?: string, alpha = '20'): string | undefined {
  const color = sanitizeSolidIconColor(value)
  return color ? `${color}${alpha}` : undefined
}

export function getIconTileStyle(value?: string, alpha = '20') {
  const color = sanitizeSolidIconColor(value)
  if (!color) {
    return undefined
  }

  return {
    backgroundColor: `${color}${alpha}`,
    color,
  }
}

export function getEntityIconColor(
  entityId: string | null | undefined,
  color?: string | null
): string {
  const sanitizedColor = sanitizeSolidIconColor(color ?? undefined)
  if (sanitizedColor) return sanitizedColor

  const seed =
    typeof entityId === 'string' && entityId.trim()
      ? entityId.trim()
      : DEFAULT_ENTITY_ICON_COLOR_SEED
  return getStableVibrantColor(seed)
}
