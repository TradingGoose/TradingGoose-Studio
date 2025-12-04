'use client'

import { useEffect } from 'react'
import { General } from './general'
import { useGeneralSettings } from '@/hooks/queries/general-settings'

interface GeneralSettingsProps {
  isActive: boolean
}

export function GeneralSettings({ isActive }: GeneralSettingsProps) {
  const { refetch } = useGeneralSettings()

  useEffect(() => {
    if (!isActive) return
    void refetch()
  }, [isActive, refetch])

  return <General />
}
