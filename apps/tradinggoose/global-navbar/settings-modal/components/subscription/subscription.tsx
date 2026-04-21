'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Skeleton, Switch } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth-client'
import { openBillingPortal as openBillingPortalSession } from '@/lib/billing/billing-portal'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'
import { formatBillingPriceLabel, formatBillingPricePeriod } from '@/lib/billing/public-catalog'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'
import { getUserRole } from '@/lib/organization'
import { getBillingStatus, getSubscriptionStatus, getUsage } from '@/lib/subscription/helpers'
import type { BillingUpgradeTarget } from '@/lib/subscription/upgrade'
import { useSubscriptionUpgrade } from '@/lib/subscription/upgrade'
import { cn } from '@/lib/utils'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { usePublicBillingCatalog } from '@/hooks/queries/public-billing-catalog'
import { useSubscriptionData, useUsageLimitData } from '@/hooks/queries/subscription'
import { useGeneralStore } from '@/stores/settings/general/store'
import { UsageHeader } from '../shared/usage-header'
import { PlanCard, UsageLimit, type UsageLimitRef, WorkspaceBillingOwnerEditor } from './components'
import {
  type PaygActivationErrorPayload,
  shouldOpenBillingPortalForPaygActivationError,
} from './payg-activation-recovery'
import { getPersonalPaygUiState } from './personal-payg-state'
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
    refetch: refetchSubscription,
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
  const [isPrimaryActionPending, setIsPrimaryActionPending] = useState(false)
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
  const hasPaymentMethodOnFile = Boolean(billingPayload?.hasPaymentMethodOnFile)
  const hasStripeSubscription = Boolean(billingPayload?.stripeSubscriptionId)
  const canEditPersonalUsageLimit = canEditUsageLimit(billingPayload)
  const personalPaygUiState = getPersonalPaygUiState({
    billingBlocked: Boolean(billingPayload?.billingBlocked),
    hasPaymentMethodOnFile,
    hasStripeSubscription,
    hasStripeMonthlyPriceId: Boolean(subscription.tier.hasStripeMonthlyPriceId),
    subscriptionStatus: billingPayload?.status ?? null,
    canEditUsageLimit: canEditPersonalUsageLimit,
    tierCanEditUsageLimit: surfaceState.canEditUsageLimit,
  })
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

  const showBadge = isOrganizationPlan
    ? surfaceState.canEditUsageLimit && !surfaceState.showTeamMemberView
    : personalPaygUiState.showBadge
  const showPersonalUsageLimitControl =
    !isOrganizationPlan &&
    personalPaygUiState.showUsageLimitControl &&
    (surfaceState.canEditUsageLimit || surfaceState.showTeamMemberView)
  const showUsageLimitControl = isOrganizationPlan
    ? surfaceState.canEditUsageLimit || surfaceState.showTeamMemberView
    : showPersonalUsageLimitControl
  const showPersonalSubscriptionManagement = !isOrganizationPlan && hasStripeSubscription
  const showManageSubscriptionRow =
    (subscription.isPaid || showPersonalSubscriptionManagement) &&
    !surfaceState.isCustomOrganizationPlan &&
    !surfaceState.showTeamMemberView
  const badgeText =
    !isOrganizationPlan && personalPaygUiState.showBadge
      ? personalPaygUiState.badgeText
      : subscription.isFree
        ? 'Upgrade'
        : 'Increase Limit'
  const hasUpgradePlans =
    surfaceState.visibleUpgradeTiers.length > 0 || surfaceState.showEnterprisePlaceholder
  const enterpriseContactUrl =
    surfaceState.enterprisePlaceholder?.contactUrl ??
    publicBillingCatalog?.enterpriseContactUrl ??
    null

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

  const openBillingPortal = useCallback(
    async (context: 'user' | 'organization') => {
      if (context === 'organization' && !activeOrgId) {
        alert('Select an organization to manage billing.')
        return
      }

      await openBillingPortalSession({
        context,
        organizationId: context === 'organization' ? activeOrgId : undefined,
      })
    },
    [activeOrgId]
  )

  const activatePayg = useCallback(async () => {
    setIsPrimaryActionPending(true)

    try {
      const response = await fetch('/api/billing/payg/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = (await response.json().catch(() => ({}))) as PaygActivationErrorPayload

      if (!response.ok) {
        if (shouldOpenBillingPortalForPaygActivationError(response.status, result)) {
          await openBillingPortal('user')
          return
        }

        throw new Error(result?.error || 'Failed to activate PAYG')
      }

      await Promise.all([refetchSubscription(), refetchUsageLimit()])
    } finally {
      setIsPrimaryActionPending(false)
    }
  }, [openBillingPortal, refetchSubscription, refetchUsageLimit])

  const handleBadgeClick = () => {
    if (isPrimaryActionPending) {
      return
    }

    if (!isOrganizationPlan && personalPaygUiState.showBadge) {
      switch (personalPaygUiState.primaryAction) {
        case 'resolve_payment':
        case 'add_payment_method':
        case 'manage_billing':
          void openBillingPortal('user').catch((error) => {
            alert(error instanceof Error ? error.message : 'Failed to open billing portal')
          })
          return
        case 'activate_payg':
          void activatePayg().catch((error) => {
            alert(error instanceof Error ? error.message : 'Failed to activate PAYG')
          })
          return
        case 'increase_limit':
          if (usageLimitRef.current) {
            usageLimitRef.current.startEdit()
          }
          return
      }
    }

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
                : showUsageLimitControl
                  ? safeNumber(usage.current)
                  : safeNumber(usage.limit)
            }
            isBlocked={Boolean(billingPayload?.billingBlocked)}
            status={normalizedBillingStatus}
            percentUsed={percentUsedClamped}
            onResolvePayment={async () => {
              try {
                await openBillingPortal(isOrganizationPlan ? 'organization' : 'user')
              } catch (error) {
                alert(error instanceof Error ? error.message : 'Failed to open billing portal')
              }
            }}
            rightContent={
              showUsageLimitControl ? (
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

        {(subscription.isPaid || showPersonalSubscriptionManagement) &&
          billingPayload?.periodEnd && (
            <div className='mt-4 flex items-center justify-between'>
              <span className='font-medium text-sm'>Next Billing Date</span>
              <span className='text-muted-foreground text-sm'>
                {new Date(billingPayload.periodEnd).toLocaleDateString()}
              </span>
            </div>
          )}

        {(subscription.isPaid || showPersonalSubscriptionManagement) && (
          <BillingUsageNotificationsToggle />
        )}

        <WorkspaceBillingOwnerEditor />

        {surfaceState.isCustomOrganizationPlan && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact your account team for billing tier and usage limit changes
            </p>
          </div>
        )}

        {showManageSubscriptionRow && (
          <div className='mt-2'>
            <div className='flex items-center justify-between'>
              <div>
                <span className='font-medium text-sm'>
                  {billingPayload?.cancelAtPeriodEnd
                    ? 'Restore Subscription'
                    : 'Manage Subscription'}
                </span>
                <p className='mt-1 text-muted-foreground text-xs'>
                  Open Stripe Billing Portal to cancel, restore, or update your subscription.
                </p>
              </div>
              <Button
                variant='outline'
                className='h-8 rounded-sm font-medium text-xs'
                onClick={() => {
                  void openBillingPortal(isOrganizationPlan ? 'organization' : 'user').catch(
                    (error) => {
                      alert(
                        error instanceof Error ? error.message : 'Failed to open billing portal'
                      )
                    }
                  )
                }}
              >
                Manage
              </Button>
            </div>
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
