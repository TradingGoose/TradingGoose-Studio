'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AccountSettings } from './components/account/account-settings'
import { ServiceSettings } from './components/service/service-settings'
import { SSO } from './components/sso/sso'
import { Subscription } from './components/subscription/subscription'
import { TeamManagement } from './components/team-management/team-management'
import { SettingsModal } from './settings-modal'
import type { SettingsSection } from './types'

interface SettingsDialogProps {
  open: boolean
  section: SettingsSection
  onOpenChange: (open: boolean) => void
}

const SECTION_CONTENT: Record<
  SettingsSection,
  (onOpenChange: (open: boolean) => void) => ReactNode
> = {
  account: () => <AccountSettings />,
  service: () => <ServiceSettings />,
  subscription: (onOpenChange) => <Subscription onOpenChange={onOpenChange} />,
  team: () => <TeamManagement />,
  sso: () => <SSO />,
}

export function SettingsDialog({ open, section, onOpenChange }: SettingsDialogProps) {
  const titles = useTranslations('workspace.settingsModal.titles')

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title={titles(section)}
      contentClassName='p-0'
    >
      {SECTION_CONTENT[section](onOpenChange)}
    </SettingsModal>
  )
}
