'use client'

import { SSO } from './sso'

interface SSOSettingsProps {
  isActive: boolean
  userId: string | null
}

export function SSOSettings({ userId }: SSOSettingsProps) {
  return <SSO userId={userId} />
}
