export interface ProviderLogoCatalogEntry {
  id: string
  title: string
  fullTitle: string
  desc: string
  param: { hasColor: boolean }
}

export interface ProviderLogoMetadata {
  id: string
  name: string
  /** Public API URL from the native SDK catalog, never deployment configuration. */
  url?: string
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

function hostname(value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
      ? url.hostname.toLowerCase().replace(/\.$/, '') || undefined
      : undefined
  } catch {
    return undefined
  }
}

/** Unique upstream identities take precedence over a shared company's website. */
export function resolveProviderLogo(
  provider: ProviderLogoMetadata,
  catalog: readonly ProviderLogoCatalogEntry[]
): { src: string; darkSrc?: string; monochrome: boolean } {
  const unmatched = {
    src: `https://models.dev/logos/${encodeURIComponent(provider.id)}.svg`,
    monochrome: true,
  }
  const names = new Set([provider.id, provider.name].map(normalize).filter(Boolean))
  let matches = catalog.filter((icon) =>
    [icon.id, icon.title, icon.fullTitle].some((name) => names.has(normalize(name)))
  )
  if (matches.length > 1) return unmatched
  if (!matches.length) {
    const apiHost = hostname(provider.url)
    if (!apiHost) return unmatched
    matches = catalog.filter((icon) => {
      const website = hostname(icon.desc)
      return website && (apiHost === website || apiHost.endsWith(`.${website}`))
    })
  }
  if (matches.length !== 1) return unmatched
  const icon = matches[0]
  const id = encodeURIComponent(icon.id.toLowerCase())
  if (icon.param.hasColor)
    return {
      src: `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/light/${id}-color.webp`,
      darkSrc: `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/dark/${id}-color.webp`,
      monochrome: false,
    }
  return {
    src: `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/${id}.svg`,
    monochrome: true,
  }
}
