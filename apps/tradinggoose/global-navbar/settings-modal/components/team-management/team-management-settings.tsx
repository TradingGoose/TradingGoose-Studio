'use client'

import { useEffect } from 'react'
import { TeamManagement } from './team-management'
import { useOrganizationStore } from '@/stores/organization'

interface TeamManagementSettingsProps {
  isActive: boolean
}

export function TeamManagementSettings({ isActive }: TeamManagementSettingsProps) {
  const loadOrganizationData = useOrganizationStore((state) => state.loadData)

  useEffect(() => {
    if (!isActive) return
    void loadOrganizationData()
  }, [isActive, loadOrganizationData])

  return <TeamManagement />
}
