'use client'

import { Subscription } from './subscription'

interface SubscriptionSettingsProps {
  userId: string | null
  onOpenChange: (open: boolean) => void
}

export function SubscriptionSettings({ userId, onOpenChange }: SubscriptionSettingsProps) {
  return <Subscription userId={userId} onOpenChange={onOpenChange} />
}
