export type ParsedMarketQuery = {
  assetClass?: string
  baseQuery?: string
  quoteQuery?: string
  region?: string
}

export function serializeArrayParam(values: string[]): string {
  return `[${values.join(',')}]`
}

export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const unique = new Set<string>()
  values.forEach((value) => {
    if (!value) return
    unique.add(value)
  })
  return Array.from(unique.values())
}

function normalizeAssetPrefix(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  const allowed = new Set([
    'stock',
    'etf',
    'indice',
    'mutualfund',
    'future',
    'crypto',
    'currency',
  ])
  return allowed.has(normalized) ? normalized : undefined
}

export function parseCategorizedSearchQuery(raw: string): ParsedMarketQuery {
  const trimmed = raw.trim()
  if (!trimmed) return {}

  let working = trimmed
  let assetClass: string | undefined

  const regionPrefixMatch = working.match(/^\[([^\]]+)\]\s*(.*)$/)
  let region: string | undefined
  if (regionPrefixMatch) {
    region = regionPrefixMatch[1].trim()
    working = (regionPrefixMatch[2] ?? '').trim()
  }

  const prefixMatch = working.match(/^([A-Za-z]+)\s*:\s*(.*)$/)
  if (prefixMatch) {
    const mapped = normalizeAssetPrefix(prefixMatch[1])
    if (mapped) {
      assetClass = mapped
      working = (prefixMatch[2] ?? '').trim()
    }
  }

  if (!region) {
    const countryMatch = working.match(/\[([^\]]+)\]\s*$/)
    if (countryMatch) {
      region = countryMatch[1].trim()
      const matchIndex = countryMatch.index ?? working.length
      working = working.slice(0, matchIndex).trim()
    }
  }

  let baseQuery: string | undefined
  let quoteQuery: string | undefined
  const slashIndex = working.indexOf('/')
  if (slashIndex >= 0) {
    baseQuery = working.slice(0, slashIndex).trim() || undefined
    quoteQuery = working.slice(slashIndex + 1).trim() || undefined
  } else {
    baseQuery = working || undefined
  }

  return { assetClass, baseQuery, quoteQuery, region }
}
