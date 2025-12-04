import type { ComponentType, CSSProperties } from 'react'

export type HeroServiceIcon = {
  key: string
  icon: ComponentType<{ className?: string }>
  label: string
  style?: CSSProperties
}

