'use client'

import { TeamManagement } from './team-management'

interface TeamManagementSettingsProps {
  isActive: boolean
  userId: string | null
}

export function TeamManagementSettings({ userId }: TeamManagementSettingsProps) {
  return <TeamManagement userId={userId} />
}
