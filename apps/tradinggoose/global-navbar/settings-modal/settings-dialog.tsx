'use client'

import { type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
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
  userId: string | null
  onOpenChange: (open: boolean) => void
}

interface SectionRenderProps {
  isActive: boolean
  userId: string | null
  onOpenChange: (open: boolean) => void
}

type SectionConfig = {
  titleKey: SettingsSection
  render: (props: SectionRenderProps) => ReactNode
}

const SECTION_CONFIG: Record<SettingsSection, SectionConfig> = {
  account: {
    titleKey: 'account',
    render: () => <AccountSettings />,
  },
  service: {
    titleKey: 'service',
    render: () => <ServiceSettings />,
  },
  subscription: {
    titleKey: 'subscription',
    render: ({ onOpenChange, userId }) => (
      <SubscriptionSettings userId={userId} onOpenChange={onOpenChange} />
    ),
  },
  team: {
    titleKey: 'team',
    render: ({ isActive, userId }) => (
      <TeamManagementSettings isActive={isActive} userId={userId} />
    ),
  },
  sso: {
    titleKey: 'sso',
    render: ({ isActive, userId }) => <SSOSettings isActive={isActive} userId={userId} />,
  },
}

export function SettingsDialog({ open, section, userId, onOpenChange }: SettingsDialogProps) {
  const titles = useTranslations('workspace.settingsModal.titles')
  const config = SECTION_CONFIG[section]

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title={titles(config.titleKey)}
      contentClassName='p-0'
    >
      {config.render({ isActive: open, userId, onOpenChange })}
    </SettingsModal>
  )
}
