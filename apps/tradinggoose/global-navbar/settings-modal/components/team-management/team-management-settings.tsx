'use client'

import { TeamManagement } from './team-management'

interface TeamManagementSettingsProps {
  isActive: boolean
}

export function TeamManagementSettings(_props: TeamManagementSettingsProps) {
  return <TeamManagement />
}
