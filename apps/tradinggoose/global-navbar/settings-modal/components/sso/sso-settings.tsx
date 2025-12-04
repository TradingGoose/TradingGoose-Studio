'use client'

import { SSO } from './sso'

interface SSOSettingsProps {
  isActive: boolean
}

export function SSOSettings(_props: SSOSettingsProps) {
  return <SSO />
}
