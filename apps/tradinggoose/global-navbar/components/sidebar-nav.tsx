'use client'

import { useEffect, useMemo } from 'react'
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
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'
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
                <SidebarMenuButton asChild isActive={item.isActive}>
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
                <SidebarMenuButton asChild isActive={item.isActive}>
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
        <div className='flex items-center gap-2'>
          <Skeleton className='h-4 w-16' />
          <Skeleton className='h-[1.125rem] w-16 rounded-[6px]' />
        </div>
        <div className='flex items-center gap-1'>
          <Skeleton className='h-3 w-10' />
          <Skeleton className='h-3 w-10' />
        </div>
      </div>
      <Skeleton className='h-2 w-full rounded' />
      <Skeleton className='h-2 w-2/3 rounded' />
    </div>
  )
}

export function SidebarUsageIndicator({ onOpenSubscriptionSettings }: SidebarUsageIndicatorProps) {
  const { state } = useSidebar()
  const logger = createLogger('SidebarUsageIndicator')
  const billingEnabled = useMemo(() => {
    const runtimeFlag = getEnv('NEXT_PUBLIC_BILLING_ENABLED')
    const buildFlag = process.env.NEXT_PUBLIC_BILLING_ENABLED ?? process.env.BILLING_ENABLED
    return isTruthy(runtimeFlag ?? buildFlag)
  }, [])
  const loadSubscriptionData = useSubscriptionStore((subscriptionState) => subscriptionState.loadData)
  const subscriptionData = useSubscriptionStore((subscriptionState) => subscriptionState.subscriptionData)
  const isSubscriptionLoading = useSubscriptionStore((subscriptionState) => subscriptionState.isLoading)
  const subscription = useSubscriptionStore((subscriptionState) => subscriptionState.getSubscriptionStatus())
  const usage = useSubscriptionStore((subscriptionState) => subscriptionState.getUsage())
  const billingStatus = useSubscriptionStore((subscriptionState) => subscriptionState.getBillingStatus())
  const activeOrganizationId = useOrganizationStore((orgState) => orgState.activeOrganization?.id)
  const organizationBillingData = useOrganizationStore((orgState) => orgState.organizationBillingData)
  const isLoadingOrgBilling = useOrganizationStore((orgState) => orgState.isLoadingOrgBilling)
  const loadOrganizationBillingData = useOrganizationStore(
    (orgState) => orgState.loadOrganizationBillingData
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
    billingEnabled && (Boolean(subscriptionData) || isSubscriptionLoading)
  const showUsageSkeleton =
    shouldShowUsageHeader &&
    (!subscriptionData ||
      (isOrganizationPlan && !organizationBillingData && isLoadingOrgBilling))

  useEffect(() => {
    if (!billingEnabled) return
    void loadSubscriptionData()
  }, [billingEnabled, loadSubscriptionData])

  useEffect(() => {
    if (!billingEnabled) return
    if (!activeOrganizationId) return
    if (!subscription.isTeam && !subscription.isEnterprise) return
    void loadOrganizationBillingData(activeOrganizationId)
  }, [
    activeOrganizationId,
    billingEnabled,
    loadOrganizationBillingData,
    subscription.isEnterprise,
    subscription.isTeam,
  ])

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
