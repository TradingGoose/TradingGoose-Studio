import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { client, useSession, useSubscription } from '@/lib/auth-client'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { BILLING_ACTIVE_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { organizationKeys } from '@/hooks/queries/organization'
import { resolveOrganizationUpgradeReference } from './upgrade-target'

const logger = createLogger('SubscriptionUpgrade')
const ENTITLED_SUBSCRIPTION_STATUSES = [
  ...BILLING_ACTIVE_SUBSCRIPTION_STATUSES,
  'past_due',
] as const

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

      let currentPersonalSubscriptionId: string | undefined
      let allSubscriptions: any[] = []
      try {
        const listResult = await client.subscription.list()
        allSubscriptions = listResult.data || []
        const activePersonalSubscription = listResult.data?.find(
          (sub: any) =>
            ENTITLED_SUBSCRIPTION_STATUSES.includes(
              sub.status as (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number]
            ) && sub.referenceId === userId
        )
        currentPersonalSubscriptionId = activePersonalSubscription?.id
      } catch (_e) {
        currentPersonalSubscriptionId = undefined
      }

      let referenceId = userId

      if (targetTier.ownerType === 'organization') {
        try {
          const orgsResponse = await fetch('/api/organizations')
          if (!orgsResponse.ok) {
            await orgsResponse.text().catch(() => {})
            throw new Error('Failed to check organization status')
          }

          const orgsData = await orgsResponse.json()
          const organizationReference = resolveOrganizationUpgradeReference({
            userId,
            organizationId: options?.organizationId,
            organizationAccess: orgsData,
            subscriptions: allSubscriptions,
          })

          referenceId = organizationReference.referenceId

          if (organizationReference.activateOrganizationId) {
            logger.info('Using existing organization for organization-tier upgrade', {
              userId,
              organizationId: organizationReference.activateOrganizationId,
            })

            try {
              await client.organization.setActive({
                organizationId: organizationReference.activateOrganizationId,
              })

              logger.info('Set organization as active', {
                organizationId: organizationReference.activateOrganizationId,
                oldReferenceId: userId,
                newReferenceId: referenceId,
              })
            } catch (error) {
              logger.warn('Failed to set organization as active, but proceeding with upgrade', {
                organizationId: organizationReference.activateOrganizationId,
                error: error instanceof Error ? error.message : 'Unknown error',
              })
            }
          } else {
            logger.info('Will create organization after payment succeeds', {
              userId,
              billingTierId: targetTier.billingTierId,
              billingTier: targetTier.displayName,
            })
          }
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
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          ...(targetTier.ownerType === 'organization' && { seats: initialSeats }),
        } as const

        const finalParams = currentPersonalSubscriptionId
          ? { ...upgradeParams, subscriptionId: currentPersonalSubscriptionId }
          : upgradeParams

        logger.info(
          currentPersonalSubscriptionId
            ? 'Upgrading existing subscription'
            : 'Creating new subscription',
          {
            billingTierId: targetTier.billingTierId,
            billingTier: targetTier.displayName,
            subscriptionId: currentPersonalSubscriptionId,
            usageScope: targetTier.usageScope,
            seatMode: targetTier.seatMode,
            referenceId,
          }
        )

        await betterAuthSubscription.upgrade(finalParams)

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
