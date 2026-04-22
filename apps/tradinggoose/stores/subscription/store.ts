import { createWithEqualityFn as create } from 'zustand/traditional'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import {
  canUpgrade as canUpgradeHelper,
  getBillingStatus as getBillingStatusHelper,
  getDaysRemainingInPeriod as getDaysRemainingInPeriodHelper,
  getRemainingBudget as getRemainingBudgetHelper,
  getSubscriptionStatus as getSubscriptionStatusHelper,
  getUsage as getUsageHelper,
} from '@/lib/subscription/helpers'
import type {
  BillingStatus,
  SubscriptionData,
  SubscriptionStore,
  UsageLimitData,
} from '@/lib/subscription/types'

const logger = createLogger('SubscriptionStore')

const CACHE_DURATION = 30 * 1000

export const useSubscriptionStore = create<SubscriptionStore>()(
  devtools(
    (set, get) => ({
      // State
      subscriptionData: null,
      usageLimitData: null,
      isLoading: false,
      error: null,
      lastFetched: null,

      // Core actions
      loadSubscriptionData: async () => {
        const state = get()

        // Check cache validity
        if (
          state.subscriptionData &&
          state.lastFetched &&
          Date.now() - state.lastFetched < CACHE_DURATION
        ) {
          logger.debug('Using cached subscription data')
          return state.subscriptionData
        }

        // Don't start multiple concurrent requests
        if (state.isLoading) {
          logger.debug('Subscription data already loading, skipping duplicate request')
          return get().subscriptionData
        }

        set({ isLoading: true, error: null })

        try {
          const response = await fetch('/api/billing?context=user')

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const result = await response.json()
          const data = { ...result.data, billingBlocked: result.data?.billingBlocked ?? false }

          // Transform dates with error handling
          const transformedData: SubscriptionData = {
            ...data,
            hasPaymentMethodOnFile: !!data.hasPaymentMethodOnFile,
            periodEnd: data.periodEnd
              ? (() => {
                  try {
                    const date = new Date(data.periodEnd)
                    return Number.isNaN(date.getTime()) ? null : date
                  } catch {
                    return null
                  }
                })()
              : null,
            usage: {
              ...data.usage,
              billingPeriodStart: data.usage?.billingPeriodStart
                ? (() => {
                    try {
                      const date = new Date(data.usage.billingPeriodStart)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
                : null,
              billingPeriodEnd: data.usage?.billingPeriodEnd
                ? (() => {
                    try {
                      const date = new Date(data.usage.billingPeriodEnd)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
                : null,
            },
            billingBlocked: !!data.billingBlocked,
          }

          // Debug logging for billing periods
          logger.debug('Billing period data', {
            raw: {
              billingPeriodStart: data.usage?.billingPeriodStart,
              billingPeriodEnd: data.usage?.billingPeriodEnd,
            },
            transformed: {
              billingPeriodStart: transformedData.usage.billingPeriodStart,
              billingPeriodEnd: transformedData.usage.billingPeriodEnd,
            },
          })

          set({
            subscriptionData: transformedData,
            isLoading: false,
            error: null,
            lastFetched: Date.now(),
          })

          logger.debug('Subscription data loaded successfully')
          return transformedData
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load subscription data'
          logger.error('Failed to load subscription data', { error })

          set({
            isLoading: false,
            error: errorMessage,
          })
          return null
        }
      },

      loadUsageLimitData: async () => {
        try {
          const response = await fetch('/api/usage?context=user')

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const result = await response.json()
          const data = result.data ?? result

          // Transform dates
          const transformedData: UsageLimitData = {
            ...data,
            updatedAt: data.updatedAt ? new Date(data.updatedAt) : undefined,
          }

          set({ usageLimitData: transformedData })
          logger.debug('Usage limit data loaded successfully')
          return transformedData
        } catch (error) {
          logger.error('Failed to load usage limit data', { error })
          // Don't set error state for usage limit failures - subscription data is more critical
          return null
        }
      },

      updateUsageLimit: async (newLimit: number) => {
        try {
          const response = await fetch('/api/usage?context=user', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ limit: newLimit }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to update usage limit')
          }

          // Refresh the store state to ensure consistency
          await get().refresh()

          logger.debug('Usage limit updated successfully', { newLimit })
          return { success: true }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to update usage limit'
          logger.error('Failed to update usage limit', { error, newLimit })
          return { success: false, error: errorMessage }
        }
      },

      refresh: async () => {
        // Force refresh by clearing cache
        set({ lastFetched: null })
        await get().loadData()
      },

      // Load both subscription and usage limit data in parallel
      loadData: async () => {
        const state = get()

        // Check cache validity for subscription data
        if (
          state.subscriptionData &&
          state.lastFetched &&
          Date.now() - state.lastFetched < CACHE_DURATION
        ) {
          logger.debug('Using cached data')
          // Still load usage limit if not present
          if (!state.usageLimitData) {
            const usageLimitData = await get().loadUsageLimitData()
            return {
              subscriptionData: state.subscriptionData,
              usageLimitData: usageLimitData,
            }
          }
          return {
            subscriptionData: state.subscriptionData,
            usageLimitData: state.usageLimitData,
          }
        }

        // Don't start multiple concurrent requests
        if (state.isLoading) {
          logger.debug('Data already loading, skipping duplicate request')
          return {
            subscriptionData: get().subscriptionData,
            usageLimitData: get().usageLimitData,
          }
        }

        set({ isLoading: true, error: null })

        try {
          // Load both subscription and usage limit data in parallel
          const [subscriptionResponse, usageLimitResponse] = await Promise.all([
            fetch('/api/billing?context=user'),
            fetch('/api/usage?context=user'),
          ])

          if (!subscriptionResponse.ok) {
            throw new Error(`HTTP error! status: ${subscriptionResponse.status}`)
          }

          const subscriptionResult = await subscriptionResponse.json()
          const subscriptionData = subscriptionResult.data
          let usageLimitData = null

          if (usageLimitResponse.ok) {
            const usageLimitResult = await usageLimitResponse.json()
            usageLimitData = usageLimitResult.data ?? usageLimitResult
          } else {
            logger.warn('Failed to load usage limit data, using defaults')
          }

          // Transform subscription data dates with error handling
          const transformedSubscriptionData: SubscriptionData = {
            ...subscriptionData,
            hasPaymentMethodOnFile: !!subscriptionData.hasPaymentMethodOnFile,
            periodEnd: subscriptionData.periodEnd
              ? (() => {
                  try {
                    const date = new Date(subscriptionData.periodEnd)
                    return Number.isNaN(date.getTime()) ? null : date
                  } catch {
                    return null
                  }
                })()
              : null,
            usage: {
              ...subscriptionData.usage,
              billingPeriodStart: subscriptionData.usage?.billingPeriodStart
                ? (() => {
                    try {
                      const date = new Date(subscriptionData.usage.billingPeriodStart)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
                : null,
              billingPeriodEnd: subscriptionData.usage?.billingPeriodEnd
                ? (() => {
                    try {
                      const date = new Date(subscriptionData.usage.billingPeriodEnd)
                      return Number.isNaN(date.getTime()) ? null : date
                    } catch {
                      return null
                    }
                  })()
                : null,
            },
          }

          // Debug logging for parallel billing periods
          logger.debug('Parallel billing period data', {
            raw: {
              billingPeriodStart: subscriptionData.usage?.billingPeriodStart,
              billingPeriodEnd: subscriptionData.usage?.billingPeriodEnd,
            },
            transformed: {
              billingPeriodStart: transformedSubscriptionData.usage.billingPeriodStart,
              billingPeriodEnd: transformedSubscriptionData.usage.billingPeriodEnd,
            },
          })

          // Transform usage limit data dates if present
          const transformedUsageLimitData: UsageLimitData | null = usageLimitData
            ? {
                ...usageLimitData,
                updatedAt: usageLimitData.updatedAt
                  ? new Date(usageLimitData.updatedAt)
                  : undefined,
              }
            : null

          set({
            subscriptionData: transformedSubscriptionData,
            usageLimitData: transformedUsageLimitData,
            isLoading: false,
            error: null,
            lastFetched: Date.now(),
          })

          logger.debug('Data loaded successfully in parallel')
          return {
            subscriptionData: transformedSubscriptionData,
            usageLimitData: transformedUsageLimitData,
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to load data'
          logger.error('Failed to load data', { error })

          set({
            isLoading: false,
            error: errorMessage,
          })
          return {
            subscriptionData: null,
            usageLimitData: null,
          }
        }
      },

      clearError: () => {
        set({ error: null })
      },

      reset: () => {
        set({
          subscriptionData: null,
          usageLimitData: null,
          isLoading: false,
          error: null,
          lastFetched: null,
        })
      },

      // Computed getters
      getSubscriptionStatus: () => getSubscriptionStatusHelper(get().subscriptionData),

      getUsage: () => getUsageHelper(get().subscriptionData),

      getBillingStatus: (): BillingStatus => getBillingStatusHelper(get().subscriptionData),

      getRemainingBudget: () => getRemainingBudgetHelper(get().subscriptionData),

      getDaysRemainingInPeriod: () => getDaysRemainingInPeriodHelper(get().subscriptionData),

      canUpgrade: () => canUpgradeHelper(get().subscriptionData),
    }),
    { name: 'subscription-store' }
  )
)
