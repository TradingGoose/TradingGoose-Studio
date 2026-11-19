import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { client, useSession } from '@/lib/auth-client'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { createLogger } from '@/lib/logs/console/logger'
import { organizationKeys } from '@/hooks/queries/organization'

const logger = createLogger('SubscriptionUpgrade')
export type BillingUpgradeTarget = Pick<
  PublicBillingTierDisplay,
  'id' | 'displayName' | 'ownerType' | 'seatCount'
>

export function getUpgradeTierIssue(tier: PublicBillingTierDisplay, occupiedSeats: number) {
  if (!tier.hasStripeMonthlyPriceId) return 'unpriced'
  if (tier.ownerType !== 'organization') return null
  const minimum = Math.max(tier.seatCount ?? 1, occupiedSeats, 1)
  const maximum = tier.seatMode === 'fixed' ? Math.max(tier.seatCount ?? 1, 1) : tier.seatMaximum
  return maximum !== null && minimum > maximum ? 'capacity' : null
}

export function useSubscriptionUpgrade() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  const handleUpgrade = useCallback(
    async (
      targetTier: BillingUpgradeTarget,
      options?: { organizationId?: string; seats?: number }
    ) => {
      const userId = session?.user?.id
      if (!userId) {
        throw new Error('User not authenticated')
      }

      const referenceId = targetTier.ownerType === 'organization' ? options?.organizationId : userId
      if (!referenceId)
        throw new Error('Select the organization whose subscription you want to change.')

      const currentUrl = `${window.location.origin}${window.location.pathname}`

      try {
        const upgradeResult = await client.subscription.upgrade({
          plan: targetTier.id,
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          ...(targetTier.ownerType === 'organization' && {
            seats: options?.seats ?? Math.max(targetTier.seatCount ?? 1, 1),
          }),
        })
        if (upgradeResult.error) {
          throw new Error(upgradeResult.error.message || 'Failed to initiate subscription upgrade')
        }

        if (targetTier.ownerType === 'organization') {
          try {
            await queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
          } catch (error) {
            logger.warn('Failed to refresh organization data after upgrade', error)
          }
        }
      } catch (error) {
        logger.error('Failed to initiate subscription upgrade:', error)
        throw new Error(
          `Failed to upgrade ${targetTier.displayName}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        )
      }
    },
    [session?.user?.id, queryClient]
  )

  return { handleUpgrade }
}
