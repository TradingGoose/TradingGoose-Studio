'use client'

import { useEffect } from 'react'
import { SettingsModal } from '../settings-modal'
import { TeamManagement } from './team-management/team-management'
import { useOrganizationStore } from '@/stores/organization'

interface TeamManagementSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TeamManagementSettingsModal({
  open,
  onOpenChange,
}: TeamManagementSettingsModalProps) {
  const loadOrganizationData = useOrganizationStore((state) => state.loadData)

  useEffect(() => {
    if (!open) return
    void loadOrganizationData()
  }, [open, loadOrganizationData])

  return (
    <SettingsModal open={open} onOpenChange={onOpenChange} title='Team Management' contentClassName='p-0'>
      <TeamManagement />
    </SettingsModal>
  )
}
