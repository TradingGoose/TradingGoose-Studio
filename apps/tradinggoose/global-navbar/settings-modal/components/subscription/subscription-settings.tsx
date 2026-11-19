'use client'

import { Subscription } from './subscription'

interface SubscriptionSettingsProps {
  onOpenChange: (open: boolean) => void
}

export function SubscriptionSettings({ onOpenChange }: SubscriptionSettingsProps) {
  return <Subscription onOpenChange={onOpenChange} />
}
