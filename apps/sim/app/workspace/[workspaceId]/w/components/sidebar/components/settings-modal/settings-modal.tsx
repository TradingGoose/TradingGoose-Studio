'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui'
import { getEnv, isTruthy } from '@/lib/env'
import {
  Account,
  Copilot,

  SettingsNavigation,
  SSO,
  Subscription,
  TeamManagement,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components'
import { useOrganizationStore } from '@/stores/organization'

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsSection =
  | 'account'

  | 'apikeys'
  | 'files'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'copilot'

const VALID_SECTIONS: SettingsSection[] = [
  'account',
  'apikeys',
  'files',
  'subscription',
  'team',
  'sso',
  'copilot',
]

const BILLING_SECTIONS: SettingsSection[] = ['subscription', 'team']

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('account')
  const { activeOrganization } = useOrganizationStore()

  useEffect(() => {
    const handleOpenSettings = (event: CustomEvent<{ tab: SettingsSection }>) => {
      const requestedSection = event.detail?.tab
      const nextSection = VALID_SECTIONS.includes(requestedSection) ? requestedSection : 'account'
      setActiveSection(nextSection)
      onOpenChange(true)
    }

    window.addEventListener('open-settings', handleOpenSettings as EventListener)

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings as EventListener)
    }
  }, [onOpenChange])

  // Redirect away from billing tabs if billing is disabled
  useEffect(() => {
    if (!isBillingEnabled && BILLING_SECTIONS.includes(activeSection)) {
      setActiveSection('account')
    }
  }, [activeSection])

  const isSubscriptionEnabled = isBillingEnabled

  // Handle dialog close
  const handleDialogOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className='flex h-[70vh] flex-col gap-0 p-0 sm:max-w-[840px]'>
        <DialogHeader className='border-b px-6 py-4'>
          <DialogTitle className='font-medium text-lg'>Settings</DialogTitle>
        </DialogHeader>

        <div className='flex min-h-0 flex-1'>
          {/* Navigation Sidebar */}
          <div className='w-[180px]'>
            <SettingsNavigation
              activeSection={activeSection}
              onSectionChange={setActiveSection}
              hasOrganization={!!activeOrganization?.id}
            />
          </div>

          {/* Content Area */}
          <div className='flex-1 overflow-y-auto'>
            {activeSection === 'account' && (
              <div className='h-full'>
                <Account onOpenChange={onOpenChange} />
              </div>
            )}

            {isSubscriptionEnabled && activeSection === 'subscription' && (
              <div className='h-full'>
                <Subscription onOpenChange={onOpenChange} />
              </div>
            )}
            {isBillingEnabled && activeSection === 'team' && (
              <div className='h-full'>
                <TeamManagement />
              </div>
            )}
            {activeSection === 'sso' && (
              <div className='h-full'>
                <SSO />
              </div>
            )}
            {activeSection === 'copilot' && (
              <div className='h-full'>
                <Copilot />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
