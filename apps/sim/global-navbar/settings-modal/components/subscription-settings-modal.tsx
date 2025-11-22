'use client'

import { SettingsModal } from '../settings-modal'
import { Subscription } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/subscription'

interface SubscriptionSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Wrap the existing workspace subscription tab inside the shared settings modal shell
export function SubscriptionSettingsModal({ open, onOpenChange }: SubscriptionSettingsModalProps) {
  return (
    <SettingsModal open={open} onOpenChange={onOpenChange} title='Subscription' contentClassName='p-0'>
      <Subscription onOpenChange={onOpenChange} />
    </SettingsModal>
  )
}
