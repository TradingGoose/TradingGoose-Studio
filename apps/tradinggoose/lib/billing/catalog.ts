import {
  type EnterprisePlaceholderDisplay,
  GENERIC_ENTERPRISE_PLACEHOLDER_DESCRIPTION,
  GENERIC_ENTERPRISE_PLACEHOLDER_FEATURES,
  type PublicBillingCatalog,
  type PublicBillingTierDisplay,
} from '@/lib/billing/public-catalog'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { getPublicBillingTiers, hasPrivateBillingTiers } from '@/lib/billing/tiers'

function toTierDisplay(tier: BillingTierRecord): PublicBillingTierDisplay {
  return {
    id: tier.id,
    displayName: tier.displayName,
    description: tier.description,
    ownerType: tier.ownerType,
    seatMode: tier.seatMode,
    usageScope: tier.usageScope,
    displayOrder: tier.displayOrder,
    monthlyPriceUsd: tier.monthlyPriceUsd === null ? null : Number(tier.monthlyPriceUsd),
    yearlyPriceUsd: tier.yearlyPriceUsd === null ? null : Number(tier.yearlyPriceUsd),
    seatCount: tier.seatCount ?? null,
    seatMaximum: tier.seatMaximum ?? null,
    canEditUsageLimit: tier.canEditUsageLimit,
    pricingFeatures: tier.pricingFeatures,
    isDefault: tier.isDefault,
  }
}

export async function getPublicBillingCatalog(): Promise<PublicBillingCatalog> {
  const [settings, publicTiers] = await Promise.all([
    getResolvedBillingSettings().catch(() => ({
      billingEnabled: false,
      enterpriseContactUrl: null,
    })),
    getPublicBillingTiers(),
  ])

  return {
    billingEnabled: settings.billingEnabled,
    publicTiers: publicTiers.map(toTierDisplay),
    enterpriseContactUrl: settings.enterpriseContactUrl,
    enterprisePlaceholder: settings.enterpriseContactUrl
      ? {
          displayName: 'Enterprise',
          description: GENERIC_ENTERPRISE_PLACEHOLDER_DESCRIPTION,
          pricingFeatures: GENERIC_ENTERPRISE_PLACEHOLDER_FEATURES,
          contactUrl: settings.enterpriseContactUrl,
        }
      : null,
  }
}

export async function getModalEnterpriseContactCard(): Promise<EnterprisePlaceholderDisplay | null> {
  const [settings, hasPrivateTiers] = await Promise.all([
    getResolvedBillingSettings().catch(() => ({ enterpriseContactUrl: null })),
    hasPrivateBillingTiers({ statuses: ['draft', 'active', 'archived'] }),
  ])
  if (!hasPrivateTiers) return null
  return {
    displayName: 'Enterprise',
    description: GENERIC_ENTERPRISE_PLACEHOLDER_DESCRIPTION,
    pricingFeatures: GENERIC_ENTERPRISE_PLACEHOLDER_FEATURES,
    contactUrl: settings.enterpriseContactUrl,
  }
}
