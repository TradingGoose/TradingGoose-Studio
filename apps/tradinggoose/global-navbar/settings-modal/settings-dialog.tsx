'use client'

import { type ReactNode } from 'react'
import { useLocale } from 'next-intl'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
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
  render: (props: SectionRenderProps) => ReactNode
}

const SECTION_CONFIG: Record<SettingsSection, SectionConfig> = {
  account: {
    render: () => <AccountSettings />,
  },
  service: {
    render: () => <ServiceSettings />,
  },
  subscription: {
    render: ({ onOpenChange }) => <SubscriptionSettings onOpenChange={onOpenChange} />,
  },
  team: {
    render: ({ isActive }) => <TeamManagementSettings isActive={isActive} />,
  },
  sso: {
    render: ({ isActive }) => <SSOSettings isActive={isActive} />,
  },
}

export function SettingsDialog({ open, section, onOpenChange }: SettingsDialogProps) {
  const locale = useLocale() as LocaleCode
  const settingsCopy = getPublicCopy(locale).workspace.settingsModal
  const config = SECTION_CONFIG[section]

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title={settingsCopy.titles[section]}
      contentClassName='p-0'
    >
      {config.render({ isActive: open, onOpenChange })}
    </SettingsModal>
  )
}
