'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Skeleton, Switch } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import {
  getBillingStatus,
  getSubscriptionStatus,
  getUsage,
} from '@/lib/subscription/helpers'
import { useSubscriptionUpgrade } from '@/lib/subscription/upgrade'
import { getBaseUrl } from '@/lib/urls/utils'
import { cn } from '@/lib/utils'
import { UsageHeader } from '../shared/usage-header'
import { CancelSubscription, PlanCard, UsageLimit, type UsageLimitRef } from './components'
import { ENTERPRISE_PLAN_FEATURES, PRO_PLAN_FEATURES, TEAM_PLAN_FEATURES } from './plan-configs'
import { getSubscriptionPermissions, getVisiblePlans } from './subscription-permissions'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData, useUsageLimitData } from '@/hooks/queries/subscription'
import { getUserRole } from '@/lib/organization'
import { useGeneralStore } from '@/stores/settings/general/store'

const CONSTANTS = {
  UPGRADE_ERROR_TIMEOUT: 3000, // 3 seconds
  TYPEFORM_ENTERPRISE_URL: 'https://form.typeform.com/to/jqCO12pF',
  PRO_PRICE: '$20',
  TEAM_PRICE: '$40',
  INITIAL_TEAM_SEATS: 1,
} as const

const STYLES = {
  GRADIENT_BADGE:
    'gradient-text h-[1.125rem] rounded-md border-gradient-primary/20 bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary px-2 py-0 font-medium text-xs cursor-pointer',
} as const

const safeNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

type TargetPlan = 'pro' | 'team'

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

const formatPlanName = (plan: string): string => plan.charAt(0).toUpperCase() + plan.slice(1)

export function Subscription({ onOpenChange }: SubscriptionProps) {
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useSubscriptionData()
  const { data: usageLimitResponse, isLoading: isUsageLimitLoading, refetch: refetchUsageLimit } =
    useUsageLimitData()
  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization
  const activeOrgId = activeOrganization?.id
  const {
    data: organizationBillingData,
    isLoading: isOrgBillingLoading,
    refetch: refetchOrgBilling,
  } = useOrganizationBilling(activeOrgId || '')

  const [upgradeError, setUpgradeError] = useState<'pro' | 'team' | null>(null)
  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  useGeneralSettings()

  const billingPayload = (subscriptionData as any)?.data ?? subscriptionData
  const organizationBillingPayload = (organizationBillingData as any)?.data ?? organizationBillingData
  const subscription = getSubscriptionStatus(billingPayload)
  const usage = getUsage(billingPayload)
  const billingStatus = getBillingStatus(billingPayload)

  const defaultMinimumLimit = subscription.isPro ? 20 : 40
  const usageLimitPayload = (usageLimitResponse as any)?.data ?? usageLimitResponse
  const usageLimitInfo = {
    currentLimit: usageLimitPayload?.currentLimit ?? usage.limit,
    minimumLimit: usageLimitPayload?.minimumLimit ?? defaultMinimumLimit,
  }

  const isOrganizationPlan = subscription.isTeam || subscription.isEnterprise
  const aggregatedCurrentUsage = safeNumber(
    isOrganizationPlan ? organizationBillingPayload?.totalCurrentUsage ?? usage.current : usage.current
  )
  const aggregatedUsageLimit = safeNumber(
    isOrganizationPlan
      ? organizationBillingPayload?.totalUsageLimit ??
      organizationBillingPayload?.minimumBillingAmount ??
      usage.limit
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
  const normalizedBillingStatus =
    billingStatus === 'unknown' ? 'ok' : (billingStatus as 'ok' | 'warning' | 'exceeded' | 'blocked')

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

  const permissions = getSubscriptionPermissions(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      plan: subscription.plan || 'free',
      status: subscription.status || 'inactive',
    },
    {
      isTeamAdmin,
      userRole: userRole || 'member',
    }
  )

  const visiblePlans = getVisiblePlans(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      plan: subscription.plan || 'free',
      status: subscription.status || 'inactive',
    },
    {
      isTeamAdmin,
      userRole: userRole || 'member',
    }
  )

  const showBadge = permissions.canEditUsageLimit && !permissions.showTeamMemberView
  const badgeText = subscription.isFree ? 'Upgrade' : 'Increase Limit'

  const handleBadgeClick = () => {
    if (subscription.isFree) {
      handleUpgrade('pro')
    } else if (permissions.canEditUsageLimit && usageLimitRef.current) {
      usageLimitRef.current.startEdit()
    }
  }

  const handleUpgradeWithErrorHandling = useCallback(
    async (targetPlan: TargetPlan) => {
      try {
        await handleUpgrade(targetPlan)
      } catch (error) {
        setUpgradeError(targetPlan)
        alert(error instanceof Error ? error.message : 'Unknown error occurred')
      }
    },
    [handleUpgrade]
  )

  const isLoading = isSubscriptionLoading || isUsageLimitLoading || isOrgBillingLoading

  if (isLoading) {
    return <SubscriptionSkeleton />
  }

  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-2'>
        <div className='mb-2'>
          <UsageHeader
            title={formatPlanName(subscription.plan)}
            gradientTitle={!subscription.isFree}
            showBadge={showBadge}
            badgeText={badgeText}
            onBadgeClick={handleBadgeClick}
            seatsText={
              permissions.canManageTeam || subscription.isEnterprise
                ? `${organizationBillingPayload?.totalSeats || subscription.seats || 1} seats`
                : undefined
            }
            current={aggregatedCurrentUsage}
            limit={
              isOrganizationPlan
                ? aggregatedUsageLimit
                : !subscription.isFree &&
                  (permissions.canEditUsageLimit || permissions.showTeamMemberView)
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
                    context:
                      subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user',
                    organizationId: activeOrgId,
                    returnUrl: `${getBaseUrl()}/workspace?billing=updated`,
                  }),
                })
                const data = await res.json()
                if (!res.ok || !data?.url)
                  throw new Error(data?.error || 'Failed to start billing portal')
                window.location.href = data.url
              } catch (e) {
                alert(e instanceof Error ? e.message : 'Failed to open billing portal')
              }
            }}
            rightContent={
              !subscription.isFree &&
                (permissions.canEditUsageLimit || permissions.showTeamMemberView) ? (
                <UsageLimit
                  ref={usageLimitRef}
                  currentLimit={
                    subscription.isTeam && isTeamAdmin
                      ? aggregatedUsageLimit
                      : usageLimitInfo.currentLimit
                  }
                  currentUsage={
                    subscription.isTeam && isTeamAdmin ? aggregatedCurrentUsage : safeNumber(usage.current)
                  }
                  canEdit={permissions.canEditUsageLimit}
                  minimumLimit={
                    subscription.isTeam && isTeamAdmin
                      ? safeNumber(
                        organizationBillingPayload?.minimumBillingAmount ?? usageLimitInfo.minimumLimit
                      )
                      : usageLimitInfo.minimumLimit
                  }
                  context={subscription.isTeam && isTeamAdmin ? 'organization' : 'user'}
                  organizationId={subscription.isTeam && isTeamAdmin ? activeOrgId : undefined}
                  onLimitUpdated={async () => {
                    if (subscription.isTeam && isTeamAdmin && activeOrgId) {
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

        {permissions.showTeamMemberView && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact your team admin to increase limits
            </p>
          </div>
        )}

        {permissions.showUpgradePlans && (
          <div className='flex flex-col gap-2'>
            {(() => {
              const totalPlans = visiblePlans.length
              const hasEnterprise = visiblePlans.includes('enterprise')

              if (subscription.isPro && totalPlans === 2) {
                return (
                  <div className='grid grid-cols-2 gap-2'>
                    {visiblePlans.map((plan) => renderPlanCard(plan, 'vertical'))}
                  </div>
                )
              }

              const otherPlans = visiblePlans.filter((p) => p !== 'enterprise')
              const enterpriseLayout =
                totalPlans === 1 || totalPlans === 3 ? 'horizontal' : 'vertical'

              return (
                <>
                  {otherPlans.length > 0 && (
                    <div
                      className={cn(
                        'grid gap-2',
                        otherPlans.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                      )}
                    >
                      {otherPlans.map((plan) => renderPlanCard(plan, 'vertical'))}
                    </div>
                  )}

                  {hasEnterprise && renderPlanCard('enterprise', enterpriseLayout)}
                </>
              )
            })()}
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

        {subscription.isEnterprise && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>
              Contact enterprise for support usage limit changes
            </p>
          </div>
        )}

        {permissions.canCancelSubscription && (
          <div className='mt-2'>
            <CancelSubscription
              subscription={{
                plan: subscription.plan,
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

  function renderPlanCard(
    planType: 'pro' | 'team' | 'enterprise',
    layout: 'vertical' | 'horizontal' = 'vertical'
  ) {
    const handleContactEnterprise = () => window.open(CONSTANTS.TYPEFORM_ENTERPRISE_URL, '_blank')

    switch (planType) {
      case 'pro':
        return (
          <PlanCard
            key='pro'
            name='Pro'
            price={CONSTANTS.PRO_PRICE}
            priceSubtext='/month'
            features={PRO_PLAN_FEATURES}
            buttonText={subscription.isFree ? 'Upgrade' : 'Upgrade to Pro'}
            onButtonClick={() => handleUpgradeWithErrorHandling('pro')}
            isError={upgradeError === 'pro'}
            layout={layout}
          />
        )

      case 'team':
        return (
          <PlanCard
            key='team'
            name='Team'
            price={CONSTANTS.TEAM_PRICE}
            priceSubtext='/month'
            features={TEAM_PLAN_FEATURES}
            buttonText={subscription.isFree ? 'Upgrade' : 'Upgrade to Team'}
            onButtonClick={() => handleUpgradeWithErrorHandling('team')}
            isError={upgradeError === 'team'}
            layout={layout}
          />
        )

      case 'enterprise':
        return (
          <PlanCard
            key='enterprise'
            name='Enterprise'
            price={<span className='font-semibold text-xl'>Custom</span>}
            priceSubtext={
              layout === 'horizontal'
                ? 'Custom solutions tailored to your enterprise needs'
                : undefined
            }
            features={ENTERPRISE_PLAN_FEATURES}
            buttonText='Contact'
            onButtonClick={handleContactEnterprise}
            layout={layout}
          />
        )

      default:
        return null
    }
  }
}

function BillingUsageNotificationsToggle() {
  const enabled = useGeneralStore((s) => s.isBillingUsageNotificationsEnabled)
  const updateSetting = useUpdateGeneralSetting()
  const isLoading = updateSetting.isPending

  return (
    <div className='mt-4 flex items-center justify-between'>
      <div className='flex flex-col'>
        <span className='font-medium text-sm'>Usage notifications</span>
        <span className='text-muted-foreground text-xs'>Email me when I reach 80% usage</span>
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
