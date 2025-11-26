'use client'

import { useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { getEnv, isTruthy } from '@/lib/env'
import { useSubscriptionStore } from '@/stores/subscription/store'
import type { NavSection } from '../types'

const LazyUsageIndicator = dynamic(
  () => import('@/global-navbar/components/usage-indicator/usage-indicator').then((mod) => mod.UsageIndicator),
  { ssr: false }
)

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

export function SidebarUsageIndicator({ onOpenSubscriptionSettings }: SidebarUsageIndicatorProps) {
  const { state } = useSidebar()
  const billingEnabled = useMemo(() => {
    const runtimeFlag = getEnv('NEXT_PUBLIC_BILLING_ENABLED')
    const buildFlag = process.env.NEXT_PUBLIC_BILLING_ENABLED ?? process.env.BILLING_ENABLED
    return isTruthy(runtimeFlag ?? buildFlag)
  }, [])

  useEffect(() => {
    if (!billingEnabled) return
    void useSubscriptionStore.getState().loadData()
  }, [billingEnabled])

  const handleUsageIndicatorClick = () => {
    if (!billingEnabled) return

    if (onOpenSubscriptionSettings) {
      onOpenSubscriptionSettings()
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
    }
  }

  if (state === 'collapsed' || !billingEnabled) return null

  return (
    <div className='px-1 py-1.5'>
      <LazyUsageIndicator onClick={handleUsageIndicatorClick} />
    </div>
  )
}
