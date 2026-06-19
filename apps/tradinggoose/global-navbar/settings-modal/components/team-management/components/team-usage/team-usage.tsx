import { useRef } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization } from '@/lib/auth-client'
import { openBillingPortal } from '@/lib/billing/billing-portal'
import { canTierEditUsageLimit } from '@/lib/billing/tier-summary'
import { UsageHeader } from '@/global-navbar/settings-modal/components/shared/usage-header'
import {
  UsageLimit,
  type UsageLimitRef,
} from '@/global-navbar/settings-modal/components/subscription/components'
import { useOrganizationBilling } from '@/hooks/queries/organization'

interface TeamUsageProps {
  hasAdminAccess: boolean
}

export function TeamUsage({ hasAdminAccess }: TeamUsageProps) {
  const { data: activeOrg } = useActiveOrganization()
  const {
    data: billingData,
    isLoading: isLoadingOrgBilling,
    error,
  } = useOrganizationBilling(activeOrg?.id || '')

  const organizationBillingPayload = (billingData as any)?.data ?? billingData

  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  if (isLoadingOrgBilling) {
    return (
      <div className='rounded-sm border bg-background p-3 shadow-xs'>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Skeleton className='h-5 w-16' />
              <Skeleton className='h-4 w-20' />
            </div>
            <div className='flex items-center gap-1 text-xs'>
              <Skeleton className='h-4 w-8' />
              <span className='text-muted-foreground'>/</span>
              <Skeleton className='h-4 w-8' />
            </div>
          </div>
          <Skeleton className='h-2 w-full rounded' />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='rounded-sm border bg-background p-3 shadow-xs'>
        <p className='text-center text-red-500 text-xs'>
          {error instanceof Error ? error.message : 'Failed to load billing data'}
        </p>
      </div>
    )
  }

  if (!organizationBillingPayload) {
    return null
  }

  const currentUsage = organizationBillingPayload.totalCurrentUsage || 0
  const currentCap =
    organizationBillingPayload.totalUsageLimit || organizationBillingPayload.minimumUsageLimit || 0
  const minimumUsageLimit = organizationBillingPayload.minimumUsageLimit || 0
  const seatsCount = organizationBillingPayload.seatsCount || 1
  const percentUsed =
    currentCap > 0 ? Math.round(Math.min((currentUsage / currentCap) * 100, 100)) : 0
  const warningThresholdPercent =
    typeof organizationBillingPayload.warningThresholdPercent === 'number'
      ? organizationBillingPayload.warningThresholdPercent
      : 100
  const status: 'ok' | 'warning' | 'exceeded' =
    percentUsed >= 100 ? 'exceeded' : percentUsed >= warningThresholdPercent ? 'warning' : 'ok'

  const title = organizationBillingPayload.subscriptionTier?.displayName || 'Organization Usage'
  const canEditUsageLimit = canTierEditUsageLimit(organizationBillingPayload.subscriptionTier)

  return (
    <UsageHeader
      title={title}
      gradientTitle
      showBadge={!!(hasAdminAccess && activeOrg?.id && canEditUsageLimit)}
      badgeText={canEditUsageLimit ? 'Increase Limit' : undefined}
      onBadgeClick={() => {
        if (canEditUsageLimit) usageLimitRef.current?.startEdit()
      }}
      seatsText={`${seatsCount} seats`}
      current={currentUsage}
      limit={currentCap}
      isBlocked={Boolean(organizationBillingPayload?.billingBlocked)}
      status={status}
      percentUsed={percentUsed}
      onResolvePayment={async () => {
        if (!activeOrg?.id) {
          alert('Select an organization to manage billing.')
          return
        }

        try {
          await openBillingPortal({
            context: 'organization',
            organizationId: activeOrg.id,
          })
        } catch (e) {
          alert(e instanceof Error ? e.message : 'Failed to open billing portal')
        }
      }}
      rightContent={
        hasAdminAccess && activeOrg?.id && canEditUsageLimit ? (
          <UsageLimit
            ref={usageLimitRef}
            currentLimit={currentCap}
            currentUsage={currentUsage}
            canEdit={hasAdminAccess && canEditUsageLimit}
            minimumLimit={minimumUsageLimit}
            context='organization'
            organizationId={activeOrg.id}
          />
        ) : (
          <span className='text-muted-foreground text-xs tabular-nums'>
            ${currentCap.toFixed(0)}
          </span>
        )
      }
      progressValue={percentUsed}
    />
  )
}
