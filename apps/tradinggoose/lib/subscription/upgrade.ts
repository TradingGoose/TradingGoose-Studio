import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession, useSubscription } from '@/lib/auth-client'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { createLogger } from '@/lib/logs/console/logger'
import { organizationKeys } from '@/hooks/queries/organization'
import { resolveOrganizationUpgradeReference } from './upgrade-target'

const logger = createLogger('SubscriptionUpgrade')
export interface BillingUpgradeTarget {
  billingTierId: string
  displayName: string
  ownerType: PublicBillingTierDisplay['ownerType']
  usageScope: PublicBillingTierDisplay['usageScope']
  seatMode: 'fixed' | 'adjustable'
  seatCount?: number | null
}

export function useSubscriptionUpgrade() {
  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const queryClient = useQueryClient()

  const handleUpgrade = useCallback(
    async (
      targetTier: BillingUpgradeTarget,
      options?: {
        seats?: number
        organizationId?: string
      }
    ) => {
      const userId = session?.user?.id
      if (!userId) {
        throw new Error('User not authenticated')
      }

      let referenceId = userId

      if (targetTier.ownerType === 'organization') {
        if (!options?.organizationId) {
          throw new Error('Select the organization whose subscription you want to change.')
        }

        try {
          const orgsResponse = await fetch('/api/organizations')
          if (!orgsResponse.ok) {
            await orgsResponse.text().catch(() => {})
            throw new Error('Failed to check organization status')
          }

          const orgsData = await orgsResponse.json()
          const organizationReference = resolveOrganizationUpgradeReference({
            organizationId: options.organizationId,
            organizationAccess: orgsData,
          })

          referenceId = organizationReference.referenceId
        } catch (error) {
          logger.error('Failed to prepare organization for organization-tier upgrade', error)
          throw error instanceof Error
            ? error
            : new Error(
                `Failed to prepare ${targetTier.displayName}. Please try again or contact support.`
              )
        }
      }

      const currentUrl = `${window.location.origin}${window.location.pathname}`
      const initialSeats = Math.max(options?.seats ?? 0, targetTier.seatCount ?? 1, 1)

      try {
        const upgradeParams = {
          plan: targetTier.billingTierId,
          referenceId,
          customerType: targetTier.ownerType,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          ...(targetTier.ownerType === 'organization' && { seats: initialSeats }),
        } as const

        logger.info('Requesting subscription upgrade', {
          billingTierId: targetTier.billingTierId,
          billingTier: targetTier.displayName,
          usageScope: targetTier.usageScope,
          seatMode: targetTier.seatMode,
          referenceId,
        })

        const upgradeResult = await betterAuthSubscription.upgrade(upgradeParams)
        if (upgradeResult.error) {
          throw new Error(upgradeResult.error.message || 'Failed to initiate subscription upgrade')
        }

        if (targetTier.ownerType === 'organization') {
          try {
            await queryClient.invalidateQueries({ queryKey: organizationKeys.lists() })
            logger.info('Refreshed organization data after organization-tier upgrade')
          } catch (error) {
            logger.warn('Failed to refresh organization data after upgrade', error)
          }
        }

        logger.info('Subscription upgrade completed successfully', {
          billingTierId: targetTier.billingTierId,
          billingTier: targetTier.displayName,
          referenceId,
        })
      } catch (error) {
        logger.error('Failed to initiate subscription upgrade:', error)

        if (error instanceof Error) {
          logger.error('Detailed error:', {
            message: error.message,
            stack: error.stack,
            cause: error.cause,
          })
        }

        throw new Error(
          `Failed to upgrade ${targetTier.displayName}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        )
      }
    },
    [session?.user?.id, betterAuthSubscription, queryClient]
  )

  return { handleUpgrade }
}
