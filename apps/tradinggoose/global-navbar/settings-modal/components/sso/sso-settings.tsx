'use client'

import { useEffect } from 'react'
import { SSO } from './sso'
import { useOrganizationStore } from '@/stores/organization'

interface SSOSettingsProps {
  isActive: boolean
}

export function SSOSettings({ isActive }: SSOSettingsProps) {
  const loadOrganizationData = useOrganizationStore((state) => state.loadData)

  useEffect(() => {
    if (!isActive) return
    void loadOrganizationData()
  }, [isActive, loadOrganizationData])

  return <SSO />
}
