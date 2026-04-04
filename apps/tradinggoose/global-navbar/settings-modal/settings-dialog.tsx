'use client'

import { ReactNode, useMemo } from 'react'
import { SettingsModal } from './settings-modal'
import { AccountSettings } from './components/account/account-settings'
import { CopilotSettings } from './components/copilot/copilot-settings'
import { SSOSettings } from './components/sso/sso-settings'
import { SubscriptionSettings } from './components/subscription/subscription-settings'
import { TeamManagementSettings } from './components/team-management/team-management-settings'
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
  copilot: {
    title: 'Copilot Settings',
    render: () => <CopilotSettings />,
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
