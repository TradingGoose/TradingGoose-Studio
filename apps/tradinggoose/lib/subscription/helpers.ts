import { compareMoney } from '@tradinggoose/billing/money'
/**
 * Helper functions for subscription-related computations
 * These are pure functions that compute values from subscription data
 */

import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type {
  BillingStatus,
  SubscriptionData,
  SubscriptionStatusData,
  UsageData,
} from '@/lib/subscription/types'

const defaultTier = EMPTY_BILLING_TIER_SUMMARY

const defaultUsage: UsageData = {
  current: null,
  limit: undefined,
  percentUsed: undefined,
  isWarning: false,
  isExceeded: false,
  billingPeriodStart: null,
  billingPeriodEnd: null,
  lastPeriodCost: null,
}

/**
 * Get subscription status flags from subscription data
 */
export function getSubscriptionStatus(
  subscriptionData: SubscriptionData | null | undefined
): SubscriptionStatusData {
  const tier = subscriptionData?.tier ?? defaultTier
  const isPaid =
    subscriptionData?.isPaid ??
    [tier.monthlyPriceUsd, tier.yearlyPriceUsd].some(
      (value) => value != null && compareMoney(value, '0') > 0
    )

  return {
    isPaid,
    isFree: !isPaid,
    status: subscriptionData?.status ?? null,
    seats: subscriptionData?.seats ?? null,
    metadata: subscriptionData?.metadata ?? null,
    tier,
  }
}

/**
 * Get usage data from subscription data
 */
export function getUsage(subscriptionData: SubscriptionData | null | undefined): UsageData {
  return subscriptionData?.usage ?? defaultUsage
}

/**
 * Get billing status based on usage and blocked state
 */
export function getBillingStatus(
  subscriptionData: SubscriptionData | null | undefined
): BillingStatus {
  if (!subscriptionData) return 'unknown'
  const usage = getUsage(subscriptionData)
  const blocked = subscriptionData?.billingBlocked
  if (blocked) return 'blocked'
  if (usage.isExceeded) return 'exceeded'
  if (usage.isWarning) return 'warning'
  return 'ok'
}
