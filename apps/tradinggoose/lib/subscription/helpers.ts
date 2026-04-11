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
  current: 0,
  limit: 0,
  percentUsed: 0,
  isWarning: false,
  isExceeded: false,
  billingPeriodStart: null,
  billingPeriodEnd: null,
  lastPeriodCost: 0,
}

/**
 * Get subscription status flags from subscription data
 */
export function getSubscriptionStatus(
  subscriptionData: SubscriptionData | null | undefined
): SubscriptionStatusData {
  const tier = subscriptionData?.tier ?? defaultTier
  const recurringPrice = Math.max(tier.monthlyPriceUsd ?? 0, tier.yearlyPriceUsd ?? 0)
  const isPaid = subscriptionData?.isPaid ?? recurringPrice > 0

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
  const usage = getUsage(subscriptionData)
  const blocked = subscriptionData?.billingBlocked
  if (blocked) return 'blocked'
  if (usage.isExceeded) return 'exceeded'
  if (usage.isWarning) return 'warning'
  return 'ok'
}

/**
 * Get remaining budget
 */
export function getRemainingBudget(subscriptionData: SubscriptionData | null | undefined): number {
  const usage = getUsage(subscriptionData)
  return Math.max(0, usage.limit - usage.current)
}

/**
 * Get days remaining in billing period
 */
export function getDaysRemainingInPeriod(
  subscriptionData: SubscriptionData | null | undefined
): number | null {
  const usage = getUsage(subscriptionData)
  if (!usage.billingPeriodEnd) return null

  const now = new Date()
  const endDate = usage.billingPeriodEnd
  const diffTime = endDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return Math.max(0, diffDays)
}

/**
 * Check if user can upgrade
 */
export function canUpgrade(subscriptionData: SubscriptionData | null | undefined): boolean {
  const status = getSubscriptionStatus(subscriptionData)
  return status.isFree || status.tier.ownerType === 'user'
}
