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
import { openBillingPortal } from '@/lib/billing/billing-portal'
import { createLogger } from '@/lib/logs/console/logger'
import { getBillingStatus, getSubscriptionStatus, getUsage } from '@/lib/subscription/helpers'
import { UsageHeader } from '@/global-navbar/settings-modal/components/shared/usage-header'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import type { NavSection } from '../types'

interface SidebarNavProps {
  navItems: NavSection[]
}

export function SidebarNav({ navItems }: SidebarNavProps) {
  const workspaceItems = navItems.filter((item) => (item.section ?? 'workspace') === 'workspace')
  const adminItems = navItems.filter((item) => item.section === 'admin')
  const moreItems = navItems.filter((item) => item.section === 'more')

  return (
    <>
      {renderNavGroup('Workspace', workspaceItems)}
      {renderNavGroup('System', adminItems)}
      {renderNavGroup('More', moreItems)}
    </>
  )
}

function renderNavGroup(label: string, items: NavSection[]) {
  if (!items.length) {
    return null
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
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
  )
}

interface SidebarUsageIndicatorProps {
  onOpenSubscriptionSettings?: () => void
}

function UsageHeaderSkeleton() {
  return (
    <div className='space-y-2 rounded-md border bg-background p-3 shadow-xs'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center justify-between gap-2'>
          <Skeleton className='h-4 w-10 rounded-full' />
          <Skeleton className='h-4 w-10 rounded-full' />
        </div>
        <div className='flex items-center justify-between gap-1'>
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
  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
  } = useSubscriptionData()
  const billingPayload = (subscriptionData as any)?.data ?? subscriptionData
  const billingEnabled = useMemo(() => billingPayload?.billingEnabled ?? true, [billingPayload])
  const subscription = getSubscriptionStatus(billingPayload)
  const usage = getUsage(billingPayload)
  const billingStatus = getBillingStatus(billingPayload)
  const { data: organizationsData } = useOrganizations()
  const activeOrganizationId = organizationsData?.activeOrganization?.id
  const { data: organizationBillingData, isLoading: isLoadingOrgBilling } = useOrganizationBilling(
    activeOrganizationId || ''
  )

  const isOrganizationPlan = subscription.tier.ownerType === 'organization'
  const currentUsage = isOrganizationPlan
    ? (organizationBillingData?.totalCurrentUsage ?? usage.current)
    : usage.current
  const usageLimit = isOrganizationPlan
    ? (organizationBillingData?.totalUsageLimit ??
      organizationBillingData?.minimumUsageLimit ??
      usage.limit)
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
  const organizationWarningThresholdPercent =
    typeof organizationBillingData?.warningThresholdPercent === 'number'
      ? organizationBillingData.warningThresholdPercent
      : 100
  const normalizedBillingStatus: 'ok' | 'warning' | 'exceeded' | 'blocked' =
    billingPayload?.billingBlocked
      ? 'blocked'
      : isOrganizationPlan
        ? percentUsed >= 100
          ? 'exceeded'
          : percentUsedRaw >= organizationWarningThresholdPercent
            ? 'warning'
            : 'ok'
        : billingStatus === 'unknown'
          ? 'ok'
          : billingStatus
  const safeCurrentUsage = Number.isFinite(currentUsage) ? Number(currentUsage) : 0
  const safeUsageLimit = Number.isFinite(usageLimit) ? Number(usageLimit) : 0
  const seatsText =
    isOrganizationPlan && organizationBillingData?.seatsCount
      ? `${organizationBillingData.seatsCount} seats`
      : subscription.seats
        ? `${subscription.seats} seats`
        : undefined
  const usageTitle = subscription.tier.displayName
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
      subscription.tier.ownerType === 'organization' ? ('organization' as const) : ('user' as const)

    if (context === 'organization' && !activeOrganizationId) {
      logger.error('Cannot resolve payment without an active organization', {
        tier: subscription.tier.displayName,
      })
      alert('Select an organization to manage billing.')
      return
    }

    try {
      await openBillingPortal({
        context,
        organizationId: context === 'organization' ? activeOrganizationId : undefined,
      })
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
