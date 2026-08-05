import {
  type BillingTierDisplay,
  GENERIC_ENTERPRISE_PLACEHOLDER_DESCRIPTION,
  GENERIC_ENTERPRISE_PLACEHOLDER_FEATURES,
  type PublicBillingCatalog,
} from '@/lib/billing/public-catalog'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { getPublicBillingTiers } from '@/lib/billing/tiers'

export function toBillingTierDisplay(tier: BillingTierRecord): BillingTierDisplay {
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
    publicTiers: publicTiers.map(toBillingTierDisplay),
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
