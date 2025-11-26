'use client'

import { useEffect } from 'react'
import { General } from './general'
import { useGeneralStore } from '@/stores/settings/general/store'

interface GeneralSettingsProps {
  isActive: boolean
}

export function GeneralSettings({ isActive }: GeneralSettingsProps) {
  const loadSettings = useGeneralStore((state) => state.loadSettings)

  useEffect(() => {
    if (!isActive) return
    void loadSettings()
  }, [isActive, loadSettings])

  return <General />
}
