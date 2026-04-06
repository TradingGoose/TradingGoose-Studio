'use client'

import { type ReactNode, useMemo } from 'react'
import { AccountSettings } from './components/account/account-settings'
import { ServiceSettings } from './components/service/service-settings'
import { SSOSettings } from './components/sso/sso-settings'
import { SubscriptionSettings } from './components/subscription/subscription-settings'
import { TeamManagementSettings } from './components/team-management/team-management-settings'
import { SettingsModal } from './settings-modal'
import type { SettingsSection } from './types'

interface SettingsDialogProps {
  open: boolean
  section: SettingsSection
  onOpenChange: (open: boolean) => void
}

interface SectionRenderProps {
  isActive: boolean
  onOpenChange: (open: boolean) => void
}

type SectionConfig = {
  title: string
  render: (props: SectionRenderProps) => ReactNode
}

const SECTION_CONFIG: Record<SettingsSection, SectionConfig> = {
  account: {
    title: 'Account Settings',
    render: () => <AccountSettings />,
  },
  service: {
    title: 'Service API Keys',
    render: () => <ServiceSettings />,
  },
  subscription: {
    title: 'Subscription',
    render: ({ onOpenChange }) => <SubscriptionSettings onOpenChange={onOpenChange} />,
  },
  team: {
    title: 'Team Management',
    render: ({ isActive }) => <TeamManagementSettings isActive={isActive} />,
  },
  sso: {
    title: 'Single Sign-On',
    render: ({ isActive }) => <SSOSettings isActive={isActive} />,
  },
}

export function SettingsDialog({ open, section, onOpenChange }: SettingsDialogProps) {
  const config = useMemo(() => SECTION_CONFIG[section], [section])

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title={config.title}
      contentClassName='p-0'
    >
      {config.render({ isActive: open, onOpenChange })}
    </SettingsModal>
  )
}
