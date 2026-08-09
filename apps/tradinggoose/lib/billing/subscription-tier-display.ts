import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { evaluateSubscriptionTierAvailability } from '@/lib/billing/tier-availability-policy'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import type { BillingTierSummary } from '@/lib/billing/types'

export interface SubscriptionTierDisplay {
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
  status: 'active' | 'draft' | 'archived' | null
  isPublic: boolean
  isCurrentOnly: boolean
}

export function toSubscriptionTierDisplay(
  tier: BillingTierRecord,
  options: { isCurrentOnly?: boolean } = {}
): SubscriptionTierDisplay {
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
    status: tier.status,
    isPublic: tier.isPublic,
    isCurrentOnly: options.isCurrentOnly ?? false,
  }
}

export function subscriptionTierDisplayFromPublicTier(
  tier: PublicBillingTierDisplay
): SubscriptionTierDisplay {
  return {
    ...tier,
    status: 'active',
    isPublic: true,
    isCurrentOnly: false,
  }
}

export function subscriptionTierDisplayFromBillingTierSummary(
  tier: BillingTierSummary,
  options: { isCurrentOnly?: boolean } = {}
): SubscriptionTierDisplay | null {
  if (!tier.id) return null
  return {
    id: tier.id,
    displayName: tier.displayName,
    description: '',
    ownerType: tier.ownerType,
    seatMode: tier.seatMode,
    usageScope: tier.usageScope,
    displayOrder: tier.displayOrder,
    monthlyPriceUsd: tier.monthlyPriceUsd,
    yearlyPriceUsd: tier.yearlyPriceUsd,
    seatCount: tier.seatCount,
    seatMaximum: tier.seatMaximum,
    canEditUsageLimit: tier.canEditUsageLimit,
    pricingFeatures: tier.pricingFeatures,
    isDefault: false,
    status: tier.status,
    isPublic: tier.isPublic,
    isCurrentOnly: options.isCurrentOnly ?? false,
  }
}

export function composeSubscriptionTierDisplays(input: {
  publicTiers: PublicBillingTierDisplay[]
  privateTiers: SubscriptionTierDisplay[]
  currentTier: BillingTierSummary | null | undefined
}): SubscriptionTierDisplay[] {
  const byId = new Map<string, SubscriptionTierDisplay>()
  for (const tier of input.publicTiers.map(subscriptionTierDisplayFromPublicTier)) {
    byId.set(tier.id, tier)
  }
  for (const tier of input.privateTiers) {
    byId.set(tier.id, tier)
  }
  const selectable = [...byId.values()].filter(
    (tier) => evaluateSubscriptionTierAvailability({ tier, isVisible: true }).isSelectable
  )
  if (input.currentTier?.id && !selectable.some((tier) => tier.id === input.currentTier?.id)) {
    const decision = evaluateSubscriptionTierAvailability({
      tier: input.currentTier,
      isVisible: false,
    })
    if (decision.isCurrentPeriodDisplayable) {
      const current = subscriptionTierDisplayFromBillingTierSummary(input.currentTier, {
        isCurrentOnly: true,
      })
      if (current) selectable.push(current)
    }
  }
  return selectable.sort(
    (left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id)
  )
}
