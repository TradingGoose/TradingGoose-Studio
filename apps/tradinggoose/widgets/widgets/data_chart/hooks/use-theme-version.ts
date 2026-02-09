'use client'

import { useEffect, useState } from 'react'

export const useThemeVersion = () => {
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setThemeVersion((prev) => prev + 1)
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  return themeVersion
}
