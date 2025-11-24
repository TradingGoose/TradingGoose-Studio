'use client'

import { useEffect } from 'react'
import { SettingsModal } from '../settings-modal'
import { General } from './general'
import { useGeneralStore } from '@/stores/settings/general/store'

interface GeneralSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Wrap the existing workspace general settings inside the shared navbar modal shell
export function GeneralSettingsModal({ open, onOpenChange }: GeneralSettingsModalProps) {
  const loadSettings = useGeneralStore((state) => state.loadSettings)

  useEffect(() => {
    if (!open) return
    void loadSettings()
  }, [open, loadSettings])

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title='General Settings'
      contentClassName='p-0'
    >
      <General />
    </SettingsModal>
  )
}
