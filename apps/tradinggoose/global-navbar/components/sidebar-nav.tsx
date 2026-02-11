'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { UsageHeader } from '@/global-navbar/settings-modal/components/shared/usage-header'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import {
  getBillingStatus,
  getSubscriptionStatus,
  getUsage,
} from '@/lib/subscription/helpers'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import type { NavSection } from '../types'

interface SidebarNavProps {
  navItems: NavSection[]
}

export function SidebarNav({ navItems }: SidebarNavProps) {
  const workspaceItems = navItems.filter((item) => (item.section ?? 'workspace') === 'workspace')
  const moreItems = navItems.filter((item) => item.section === 'more')

  return (
    <>
      {workspaceItems.length ? (
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {workspaceItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={item.isActive} tooltip={item.title}>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ) : null}

      {moreItems.length ? (
        <SidebarGroup>
          <SidebarGroupLabel>More</SidebarGroupLabel>
          <SidebarMenu>
            {moreItems.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={item.isActive} tooltip={item.title}>
                  <Link href={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ) : null}
    </>
  )
}

interface SidebarUsageIndicatorProps {
  onOpenSubscriptionSettings?: () => void
}

function UsageHeaderSkeleton() {
  return (
    <div className='space-y-2 rounded-md border bg-background p-3 shadow-xs'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2 justify-between'>
          <Skeleton className='h-4 w-10 rounded-full' />
          <Skeleton className='h-4 w-10 rounded-full' />
        </div>
        <div className='flex items-center gap-1 justify-between'>
          <Skeleton className='h-3 w-full rounded-full' />
          <Skeleton className='h-3 w-full rounded-full' />
        </div>
      </div>
      <Skeleton className='h-2 w-full rounded' />
    </div>
  )
}

export function SidebarUsageIndicator({ onOpenSubscriptionSettings }: SidebarUsageIndicatorProps) {
  const { state } = useSidebar()
  const logger = createLogger('SidebarUsageIndicator')
  const billingEnabled = useMemo(() => {
    const runtimeFlag = getEnv('NEXT_PUBLIC_BILLING_ENABLED')
    const buildFlag = process.env.NEXT_PUBLIC_BILLING_ENABLED
    return isTruthy(runtimeFlag ?? buildFlag ?? true)
  }, [])
  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useSubscriptionData()
  const billingPayload = (subscriptionData as any)?.data ?? subscriptionData
  const subscription = getSubscriptionStatus(billingPayload)
  const usage = getUsage(billingPayload)
  const billingStatus = getBillingStatus(billingPayload)
  const { data: organizationsData } = useOrganizations()
  const activeOrganizationId = organizationsData?.activeOrganization?.id
  const { data: organizationBillingData, isLoading: isLoadingOrgBilling } = useOrganizationBilling(
    activeOrganizationId || ''
  )

  const normalizedBillingStatus: 'ok' | 'warning' | 'exceeded' | 'blocked' =
    billingStatus === 'unknown' ? 'ok' : billingStatus
  const isOrganizationPlan = subscription.isTeam || subscription.isEnterprise
  const currentUsage = isOrganizationPlan
    ? organizationBillingData?.totalCurrentUsage ?? usage.current
    : usage.current
  const usageLimit = isOrganizationPlan
    ? organizationBillingData?.totalUsageLimit ??
    organizationBillingData?.minimumBillingAmount ??
    usage.limit
    : usage.limit
  const percentUsedRaw = isOrganizationPlan
    ? (() => {
      const totalLimit = organizationBillingData?.totalUsageLimit
      if (totalLimit && totalLimit > 0) {
        return ((organizationBillingData?.totalCurrentUsage ?? 0) / totalLimit) * 100
      }
      return usage.percentUsed
    })()
    : usage.percentUsed
  const percentUsed = Math.max(0, Math.min(Math.round(percentUsedRaw ?? 0), 100))
  const safeCurrentUsage = Number.isFinite(currentUsage) ? Number(currentUsage) : 0
  const safeUsageLimit = Number.isFinite(usageLimit) ? Number(usageLimit) : 0
  const seatsText =
    isOrganizationPlan && organizationBillingData?.seatsCount
      ? `${organizationBillingData.seatsCount} seats`
      : subscription.seats
        ? `${subscription.seats} seats`
        : undefined
  const usageTitle = subscription.plan
    ? `${subscription.plan.charAt(0).toUpperCase()}${subscription.plan.slice(1)}`
    : 'Free'
  const shouldShowUsageHeader =
    billingEnabled && (Boolean(subscriptionData) || isSubscriptionLoading || isSubscriptionError)
  const showUsageSkeleton =
    shouldShowUsageHeader &&
    (!subscriptionData || (isOrganizationPlan && !organizationBillingData && isLoadingOrgBilling))

  const handleOpenSubscriptionSettings = () => {
    if (!billingEnabled) return

    if (onOpenSubscriptionSettings) {
      onOpenSubscriptionSettings()
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
    }
  }

  const handleResolvePayment = async () => {
    const context =
      subscription.isTeam || subscription.isEnterprise ? ('organization' as const) : ('user' as const)

    if (context === 'organization' && !activeOrganizationId) {
      logger.error('Cannot resolve payment without an active organization', {
        plan: subscription.plan,
      })
      alert('Select an organization to manage billing.')
      return
    }

    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          organizationId: context === 'organization' ? activeOrganizationId : undefined,
          returnUrl: `${getBaseUrl()}/workspace?billing=updated`,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.url) throw new Error(data?.error || 'Failed to start billing portal')
      window.location.href = data.url
    } catch (error) {
      logger.error('Failed to open billing portal from sidebar usage indicator', { error })
      alert(error instanceof Error ? error.message : 'Failed to open billing portal')
    }
  }

  if (state === 'collapsed' || !billingEnabled || !shouldShowUsageHeader) return null

  return (
    <div
      role='button'
      tabIndex={0}
      className='w-full'
      onClick={handleOpenSubscriptionSettings}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleOpenSubscriptionSettings()
        }
      }}
    >
      {showUsageSkeleton ? (
        <UsageHeaderSkeleton />
      ) : (
        <UsageHeader
          title={usageTitle}
          gradientTitle={!subscription.isFree}
          showBadge={false}
          seatsText={seatsText}
          current={safeCurrentUsage}
          limit={safeUsageLimit}
          isBlocked={normalizedBillingStatus === 'blocked'}
          onResolvePayment={
            normalizedBillingStatus === 'blocked' ? handleResolvePayment : undefined
          }
          status={normalizedBillingStatus}
          percentUsed={percentUsed}
          progressValue={percentUsed}
        />
      )}
    </div>
  )
}
