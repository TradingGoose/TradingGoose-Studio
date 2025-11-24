'use client'

import { SettingsModal } from '../settings-modal'
import { Copilot } from './copilot/copilot'

interface CopilotSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Wrap the copilot settings inside the shared navbar modal shell
export function CopilotSettingsModal({ open, onOpenChange }: CopilotSettingsModalProps) {
  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title='Copilot Settings'
      contentClassName='p-0'
    >
      <Copilot />
    </SettingsModal>
  )
}
