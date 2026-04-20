'use client'

import { useEffect, useState } from 'react'
import type { ColorMode } from '@xyflow/react'

export function useXYFlowColorMode(): ColorMode {
  const [colorMode, setColorMode] = useState<ColorMode>('light')

  useEffect(() => {
    const root = document.documentElement
    const syncColorMode = () => {
      setColorMode(root.classList.contains('dark') ? 'dark' : 'light')
    }

    syncColorMode()

    const observer = new MutationObserver(syncColorMode)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  return colorMode
}
