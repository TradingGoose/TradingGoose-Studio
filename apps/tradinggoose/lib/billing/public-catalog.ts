export interface PublicBillingTierDisplay {
  id: string
  displayName: string
  description: string
  ownerType: 'user' | 'organization'
  seatMode: 'fixed' | 'adjustable'
  usageScope: 'individual' | 'pooled'
  displayOrder: number
  monthlyPriceUsd: number | null
  yearlyPriceUsd: number | null
  seatCount: number | null
  seatMaximum: number | null
  canEditUsageLimit: boolean
  pricingFeatures: string[]
  isDefault: boolean
}

export interface EnterprisePlaceholderDisplay {
  displayName: 'Enterprise'
  description: string
  pricingFeatures: string[]
  contactUrl: string | null
}

export interface PublicBillingCatalog {
  billingEnabled: boolean
  publicTiers: PublicBillingTierDisplay[]
  enterprisePlaceholder: EnterprisePlaceholderDisplay | null
  enterpriseContactUrl: string | null
}

export const GENERIC_ENTERPRISE_PLACEHOLDER_DESCRIPTION =
  'Custom pricing, security, and support for organizations with tailored billing and access controls.'

export const GENERIC_ENTERPRISE_PLACEHOLDER_FEATURES = [
  'Custom contract pricing',
  'Organization-wide pooled billing',
  'Dedicated onboarding and support',
]

function getPrimaryRecurringPrice(tier: {
  monthlyPriceUsd: number | null
  yearlyPriceUsd: number | null
}): { value: number; period: '/mo' | '/yr' | null } {
  if ((tier.monthlyPriceUsd ?? 0) > 0) {
    return { value: tier.monthlyPriceUsd ?? 0, period: '/mo' }
  }

  if ((tier.yearlyPriceUsd ?? 0) > 0) {
    return { value: tier.yearlyPriceUsd ?? 0, period: '/yr' }
  }

  return { value: 0, period: null }
}

function joinWithAnd(values: string[]): string {
  if (values.length === 0) {
    return ''
  }

  if (values.length === 1) {
    return values[0]
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`
  }

  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function describePrice(
  tier:
    | Pick<PublicBillingTierDisplay, 'monthlyPriceUsd' | 'yearlyPriceUsd'>
    | EnterprisePlaceholderDisplay
): string {
  if (!('monthlyPriceUsd' in tier)) {
    return 'custom'
  }

  const price = getPrimaryRecurringPrice(tier)

  if (price.value <= 0) {
    return 'free'
  }

  return `$${price.value.toFixed(0)}${price.period}`
}

export function formatBillingPriceLabel(tier: {
  monthlyPriceUsd: number | null
  yearlyPriceUsd: number | null
}): string {
  const price = getPrimaryRecurringPrice(tier)

  if (price.value <= 0) {
    return 'Free'
  }

  return `$${price.value.toFixed(0)}`
}

export function formatBillingPricePeriod(tier: {
  monthlyPriceUsd: number | null
  yearlyPriceUsd: number | null
}): string | null {
  return getPrimaryRecurringPrice(tier).period
}

export function buildHostedPricingSummary(catalog: PublicBillingCatalog): string {
  const entries = catalog.publicTiers.map((tier) => {
    const price = formatBillingPriceLabel(tier)
    const period = formatBillingPricePeriod(tier)

    return price === 'Free'
      ? `${tier.displayName} free`
      : `${tier.displayName} ${price}${period ?? ''}`
  })

  if (catalog.enterprisePlaceholder) {
    entries.push(`${catalog.enterprisePlaceholder.displayName} custom`)
  }

  return entries.join(', ')
}

export function buildHostedPricingSentence(catalog: PublicBillingCatalog): string {
  const entries = catalog.publicTiers.map((tier) => `${tier.displayName} (${describePrice(tier)})`)

  if (catalog.enterprisePlaceholder) {
    entries.push(`${catalog.enterprisePlaceholder.displayName} (custom)`)
  }

  return joinWithAnd(entries)
}

export function buildHostedPricingNarrative(catalog: PublicBillingCatalog): string {
  const entries = catalog.publicTiers.map((tier) => {
    const description = tier.description.trim().endsWith('.')
      ? tier.description.trim()
      : `${tier.description.trim()}.`
    return `${tier.displayName} is ${describePrice(tier)}. ${description}`
  })

  if (catalog.enterprisePlaceholder) {
    const description = catalog.enterprisePlaceholder.description.trim()
    entries.push(
      description
        ? `Enterprise is custom-priced. ${description.endsWith('.') ? description : `${description}.`}`
        : 'Enterprise is custom-priced for organizations with tailored billing and support.'
    )
  }

  return entries.join(' ')
}

export function buildHostedPricingMarkdownTable(catalog: PublicBillingCatalog): string {
  const rows = catalog.publicTiers.map((tier) => {
    const features =
      tier.pricingFeatures.length > 0 ? tier.pricingFeatures.join(', ') : 'See hosted plan details'

    return `| ${tier.displayName} | ${describePrice(tier)} | ${tier.description} | ${features} |`
  })

  if (catalog.enterprisePlaceholder) {
    const features =
      catalog.enterprisePlaceholder.pricingFeatures.length > 0
        ? catalog.enterprisePlaceholder.pricingFeatures.join(', ')
        : 'Custom sales-managed billing and support'

    rows.push(
      `| ${catalog.enterprisePlaceholder.displayName} | custom | ${catalog.enterprisePlaceholder.description} | ${features} |`
    )
  }

  return ['| Tier | Price | Best for | Key limits |', '|---|---|---|---|', ...rows].join('\n')
}
