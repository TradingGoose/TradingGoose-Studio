'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Skeleton, Switch } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { formatBillingPriceLabel, formatBillingPricePeriod } from '@/lib/billing/public-catalog'
import { getUserRole } from '@/lib/organization'
import { getBillingStatus, getSubscriptionStatus, getUsage } from '@/lib/subscription/helpers'
import type { BillingUpgradeTarget } from '@/lib/subscription/upgrade'
import { useSubscriptionUpgrade } from '@/lib/subscription/upgrade'
import { getBaseUrl } from '@/lib/urls/utils'
import { cn } from '@/lib/utils'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { usePublicBillingCatalog } from '@/hooks/queries/public-billing-catalog'
import { useSubscriptionData, useUsageLimitData } from '@/hooks/queries/subscription'
import { useGeneralStore } from '@/stores/settings/general/store'
import { UsageHeader } from '../shared/usage-header'
import {
  CancelSubscription,
  PlanCard,
  UsageLimit,
  type UsageLimitRef,
  WorkspaceBillingOwnerEditor,
} from './components'
import { toPlanFeatures } from './plan-configs'
import { getSubscriptionSurfaceState } from './subscription-permissions'

const CONSTANTS = {
  UPGRADE_ERROR_TIMEOUT: 3000,
} as const

const safeNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

function SubscriptionSkeleton() {
  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-2'>
        <div className='mb-2'>
          <div className='rounded-md border bg-background p-3 shadow-xs'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-5 w-16' />
                  <Skeleton className='h-[1.125rem] w-14 rounded-sm' />
                </div>
                <div className='flex items-center gap-1 text-xs tabular-nums'>
                  <Skeleton className='h-4 w-8' />
                  <span className='text-muted-foreground'>/</span>
                  <Skeleton className='h-4 w-8' />
                </div>
              </div>
              <Skeleton className='h-2 w-full rounded' />
            </div>
          </div>
        </div>

        <div className='flex flex-col gap-2'>
          <div className='grid grid-cols-2 gap-2'>
            <div className='flex flex-col rounded-sm border p-4'>
              <div className='mb-4'>
                <Skeleton className='mb-2 h-5 w-8' />
                <div className='flex items-baseline'>
                  <Skeleton className='h-6 w-10' />
                  <Skeleton className='ml-1 h-3 w-12' />
                </div>
              </div>
              <div className='mb-4 flex-1 space-y-2'>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className='flex items-start gap-2'>
                    <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                    <Skeleton className='h-3 w-20' />
                  </div>
                ))}
              </div>
              <Skeleton className='h-9 w-full rounded-sm' />
            </div>

            <div className='flex flex-col rounded-sm border p-4'>
              <div className='mb-4'>
                <Skeleton className='mb-2 h-5 w-10' />
                <div className='flex items-baseline'>
                  <Skeleton className='h-6 w-10' />
                  <Skeleton className='ml-1 h-3 w-12' />
                </div>
              </div>
              <div className='mb-4 flex-1 space-y-2'>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className='flex items-start gap-2'>
                    <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                    <Skeleton className='h-3 w-24' />
                  </div>
                ))}
              </div>
              <Skeleton className='h-9 w-full rounded-sm' />
            </div>
          </div>

          <div className='flex items-center justify-between rounded-sm border p-4'>
            <div>
              <Skeleton className='mb-2 h-5 w-20' />
              <Skeleton className='mb-3 h-3 w-64' />
              <div className='flex items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-16' />
                </div>
                <div className='h-4 w-px bg-border' />
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
                <div className='h-4 w-px bg-border' />
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
              </div>
            </div>
            <Skeleton className='h-9 w-16 rounded-sm' />
          </div>
        </div>
      </div>
    </div>
  )
}

function toUpgradeTarget(tier: PublicBillingTierDisplay): BillingUpgradeTarget {
  return {
    billingTierId: tier.id,
    displayName: tier.displayName,
    ownerType: tier.ownerType,
    usageScope: tier.usageScope,
    seatMode: tier.seatMode === 'adjustable' ? 'adjustable' : 'fixed',
    seatCount: tier.seatCount,
  }
}

function openContactUrl(url: string | null) {
  if (!url) {
    return
  }

  window.open(url, '_blank')
}

export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useSubscriptionData()
  const {
    data: usageLimitResponse,
    isLoading: isUsageLimitLoading,
    refetch: refetchUsageLimit,
  } = useUsageLimitData()
  const { data: organizationsData } = useOrganizations()
  const { data: publicBillingCatalog, isLoading: isCatalogLoading } = usePublicBillingCatalog()

  const activeOrganization = organizationsData?.activeOrganization
  const activeOrgId = activeOrganization?.id
  const {
    data: organizationBillingData,
    isLoading: isOrgBillingLoading,
    refetch: refetchOrgBilling,
  } = useOrganizationBilling(activeOrgId || '')

  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  useGeneralSettings()

  const billingPayload = (subscriptionData as any)?.data ?? subscriptionData
  const organizationBillingPayload =
    (organizationBillingData as any)?.data ?? organizationBillingData
  const subscription = getSubscriptionStatus(billingPayload)
  const usage = getUsage(billingPayload)
  const billingStatus = getBillingStatus(billingPayload)

  const defaultMinimumLimit = safeNumber(subscription.tier.monthlyPriceUsd)
  const usageLimitPayload = (usageLimitResponse as any)?.data ?? usageLimitResponse
  const usageLimitInfo = {
    currentLimit: usageLimitPayload?.currentLimit ?? usage.limit,
    minimumLimit: usageLimitPayload?.minimumLimit ?? defaultMinimumLimit,
  }

  useEffect(() => {
    if (upgradeError) {
      const timer = setTimeout(() => {
        setUpgradeError(null)
      }, CONSTANTS.UPGRADE_ERROR_TIMEOUT)
      return () => clearTimeout(timer)
    }
  }, [upgradeError])

  const userRole = getUserRole(activeOrganization, session?.user?.email)
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)

  const surfaceState = getSubscriptionSurfaceState({
    subscription: {
      isFree: subscription.isFree,
      isPaid: subscription.isPaid,
      tier: subscription.tier,
    },
    userRole: {
      isTeamAdmin,
    },
    publicTiers: publicBillingCatalog?.publicTiers ?? [],
    enterprisePlaceholder: publicBillingCatalog?.enterprisePlaceholder ?? null,
  })

  const isOrganizationPlan = surfaceState.isOrganizationPlan
  const aggregatedCurrentUsage = safeNumber(
    isOrganizationPlan
      ? (organizationBillingPayload?.totalCurrentUsage ?? usage.current)
      : usage.current
  )
  const aggregatedUsageLimit = safeNumber(
    isOrganizationPlan
      ? (organizationBillingPayload?.totalUsageLimit ??
          organizationBillingPayload?.minimumUsageLimit ??
          usage.limit)
      : usage.limit
  )
  const percentUsedRaw = isOrganizationPlan
    ? (() => {
        const totalLimit = organizationBillingPayload?.totalUsageLimit
        if (totalLimit && totalLimit > 0) {
          return ((organizationBillingPayload?.totalCurrentUsage ?? 0) / totalLimit) * 100
        }
        return usage.percentUsed
      })()
    : usage.percentUsed
  const percentUsedClamped = Math.max(0, Math.min(Math.round(percentUsedRaw ?? 0), 100))
  const organizationWarningThresholdPercent =
    typeof organizationBillingPayload?.warningThresholdPercent === 'number'
      ? organizationBillingPayload.warningThresholdPercent
      : 100
  const normalizedBillingStatus = billingPayload?.billingBlocked
    ? 'blocked'
    : isOrganizationPlan
      ? percentUsedClamped >= 100
        ? 'exceeded'
        : percentUsedRaw >= organizationWarningThresholdPercent
          ? 'warning'
          : 'ok'
      : billingStatus === 'unknown'
        ? 'ok'
        : (billingStatus as 'ok' | 'warning' | 'exceeded' | 'blocked')

  const showBadge = surfaceState.canEditUsageLimit && !surfaceState.showTeamMemberView
  const badgeText = subscription.isFree ? 'Upgrade' : 'Increase Limit'
  const hasUpgradePlans =
    surfaceState.visibleUpgradeTiers.length > 0 || surfaceState.showEnterprisePlaceholder
  const enterpriseContactUrl =
    surfaceState.enterprisePlaceholder?.contactUrl ??
    publicBillingCatalog?.enterpriseContactUrl ??
    null

  const handleBadgeClick = () => {
    if (subscription.isFree) {
      const defaultUpgradeTier = surfaceState.visibleUpgradeTiers[0]
      if (defaultUpgradeTier) {
        void handleUpgradeWithErrorHandling(toUpgradeTarget(defaultUpgradeTier))
      }
      return
    }

    if (surfaceState.canEditUsageLimit && usageLimitRef.current) {
      usageLimitRef.current.startEdit()
    }
  }

  const handleUpgradeWithErrorHandling = useCallback(
    async (targetTier: BillingUpgradeTarget) => {
      try {
        await handleUpgrade(targetTier, {
          ...(targetTier.ownerType === 'organization' && activeOrgId
            ? { organizationId: activeOrgId }
            : {}),
        })
      } catch (error) {
        setUpgradeError(targetTier.billingTierId)
        alert(error instanceof Error ? error.message : 'Unknown error occurred')
      }
    },
    [activeOrgId, handleUpgrade]
  )

  const isLoading =
    isSubscriptionLoading || isUsageLimitLoading || isOrgBillingLoading || isCatalogLoading

  if (isLoading) {
    return <SubscriptionSkeleton />
  }

  if (isSubscriptionError) {
    onOpenChange(false)
    return null
  }

  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-2'>
        <div className='mb-2'>
          <UsageHeader
            title={subscription.tier.displayName}
            gradientTitle={!subscription.isFree}
            showBadge={showBadge}
            badgeText={badgeText}
            onBadgeClick={handleBadgeClick}
            seatsText={
              surfaceState.canManageOrganizationPlan || surfaceState.isCustomOrganizationPlan
                ? `${organizationBillingPayload?.totalSeats || subscription.seats || 1} seats`
                : undefined
            }
            current={aggregatedCurrentUsage}
            limit={
              isOrganizationPlan
                ? aggregatedUsageLimit
                : !subscription.isFree &&
                    (surfaceState.canEditUsageLimit || surfaceState.showTeamMemberView)
                  ? safeNumber(usage.current)
                  : safeNumber(usage.limit)
            }
            isBlocked={Boolean(billingPayload?.billingBlocked)}
            status={normalizedBillingStatus}
            percentUsed={percentUsedClamped}
            onResolvePayment={async () => {
              try {
                const res = await fetch('/api/billing/portal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    context: isOrganizationPlan ? 'organization' : 'user',
                    organizationId: activeOrgId,
                    returnUrl: `${getBaseUrl()}/workspace?billing=updated`,
                  }),
                })
                const data = await res.json()
                if (!res.ok || !data?.url) {
                  throw new Error(data?.error || 'Failed to start billing portal')
                }
                window.location.href = data.url
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Failed to open billing portal')
              }
            }}
            rightContent={
              !subscription.isFree &&
              (surfaceState.canEditUsageLimit || surfaceState.showTeamMemberView) ? (
                <UsageLimit
                  ref={usageLimitRef}
                  currentLimit={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin
                      ? aggregatedUsageLimit
                      : usageLimitInfo.currentLimit
                  }
                  currentUsage={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin
                      ? aggregatedCurrentUsage
                      : safeNumber(usage.current)
                  }
                  canEdit={surfaceState.canEditUsageLimit}
                  minimumLimit={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin
                      ? safeNumber(
                          organizationBillingPayload?.minimumUsageLimit ??
                            usageLimitInfo.minimumLimit
                        )
                      : usageLimitInfo.minimumLimit
                  }
                  context={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin ? 'organization' : 'user'
                  }
                  organizationId={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin ? activeOrgId : undefined
                  }
                  onLimitUpdated={async () => {
                    if (surfaceState.isAdjustableSeatPlan && isTeamAdmin && activeOrgId) {
                      await refetchOrgBilling()
                    } else {
                      await refetchUsageLimit()
                    }
                  }}
                />
              ) : undefined
            }
            progressValue={percentUsedClamped}
          />
        </div>

        {surfaceState.showTeamMemberView && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact your team admin to increase limits
            </p>
          </div>
        )}

        {hasUpgradePlans && (
          <div className='flex flex-col gap-2'>
            {surfaceState.visibleUpgradeTiers.length > 0 && (
              <div
                className={cn(
                  'grid gap-2',
                  surfaceState.visibleUpgradeTiers.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                )}
              >
                {surfaceState.visibleUpgradeTiers.map((tier) => (
                  <PlanCard
                    key={tier.id}
                    name={tier.displayName}
                    price={formatBillingPriceLabel(tier)}
                    priceSubtext={formatBillingPricePeriod(tier) ?? undefined}
                    features={toPlanFeatures(tier.pricingFeatures)}
                    buttonText={subscription.isFree ? 'Upgrade' : `Upgrade to ${tier.displayName}`}
                    onButtonClick={() => handleUpgradeWithErrorHandling(toUpgradeTarget(tier))}
                    isError={upgradeError === tier.id}
                    layout='vertical'
                  />
                ))}
              </div>
            )}

            {surfaceState.showEnterprisePlaceholder && surfaceState.enterprisePlaceholder && (
              <PlanCard
                name={surfaceState.enterprisePlaceholder.displayName}
                price='Custom'
                priceSubtext={
                  surfaceState.visibleUpgradeTiers.length !== 1
                    ? surfaceState.enterprisePlaceholder.description
                    : undefined
                }
                features={toPlanFeatures(surfaceState.enterprisePlaceholder.pricingFeatures)}
                buttonText='Contact'
                onButtonClick={() => openContactUrl(enterpriseContactUrl)}
                layout={surfaceState.visibleUpgradeTiers.length === 1 ? 'vertical' : 'horizontal'}
              />
            )}
          </div>
        )}

        {subscription.isPaid && billingPayload?.periodEnd && (
          <div className='mt-4 flex items-center justify-between'>
            <span className='font-medium text-sm'>Next Billing Date</span>
            <span className='text-muted-foreground text-sm'>
              {new Date(billingPayload.periodEnd).toLocaleDateString()}
            </span>
          </div>
        )}

        {subscription.isPaid && <BillingUsageNotificationsToggle />}

        <WorkspaceBillingOwnerEditor />

        {surfaceState.isCustomOrganizationPlan && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact your account team for billing tier and usage limit changes
            </p>
          </div>
        )}

        {surfaceState.canCancelSubscription && (
          <div className='mt-2'>
            <CancelSubscription
              subscription={{
                tierDisplayName: subscription.tier.displayName,
                status: subscription.status,
                isPaid: subscription.isPaid,
              }}
              subscriptionData={{
                periodEnd: billingPayload?.periodEnd || null,
                cancelAtPeriodEnd: billingPayload?.cancelAtPeriodEnd,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function BillingUsageNotificationsToggle() {
  const enabled = useGeneralStore((s) => s.isBillingUsageNotificationsEnabled)
  const updateSetting = useUpdateGeneralSetting()
  const isLoading = updateSetting.isPending

  return (
    <div className='mt-4 flex items-center justify-between'>
      <div className='flex flex-col'>
        <span className='font-medium text-sm'>Usage notifications</span>
        <span className='text-muted-foreground text-xs'>
          Email me when usage reaches the billing warning threshold
        </span>
      </div>
      <Switch
        checked={!!enabled}
        disabled={isLoading}
        onCheckedChange={(v: boolean) => {
          if (v !== enabled) {
            updateSetting.mutate({ key: 'billingUsageNotificationsEnabled', value: v })
          }
        }}
      />
    </div>
  )
}
