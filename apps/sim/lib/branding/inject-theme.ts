function normalizeHexColor(hexColor: string): string {
  let normalized = hexColor.trim()
  if (!normalized.startsWith('#')) {
    normalized = `#${normalized}`
  }

  if (normalized.length === 4) {
    normalized =
      `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
  }

  return normalized
}

function hexToHsl(hexColor: string): string {
  const normalized = normalizeHexColor(hexColor)
  const r = Number.parseInt(normalized.slice(1, 3), 16) / 255
  const g = Number.parseInt(normalized.slice(3, 5), 16) / 255
  const b = Number.parseInt(normalized.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const delta = max - min
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)

    switch (max) {
      case r:
        h = (g - b) / delta + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / delta + 2
        break
      default:
        h = (r - g) / delta + 4
        break
    }

    h /= 6
  }

  return `${(h * 360).toFixed(2)} ${(s * 100).toFixed(2)}% ${(l * 100).toFixed(2)}%`
}

export function generateThemeCSS(): string {
  const cssVars: string[] = []

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR) {
    cssVars.push(`--primary: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR) {
    cssVars.push(`--primary-hover: ${process.env.NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR) {
    cssVars.push(`--accent: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR) {
    cssVars.push(`--accent-hover: ${process.env.NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR};`)
  }

  if (process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR) {
    const normalizedBackground = normalizeHexColor(process.env.NEXT_PUBLIC_BRAND_BACKGROUND_COLOR)
    cssVars.push(`--background-hex: ${normalizedBackground};`)
    cssVars.push(`--background: ${hexToHsl(normalizedBackground)};`)
  }

  return cssVars.length > 0 ? `:root { ${cssVars.join(' ')} }` : ''
}
