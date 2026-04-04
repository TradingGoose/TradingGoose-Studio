'use client'

import { type ReactNode, useRef } from 'react'
import { getBlockTypeIcon } from './block-type-icon'
import { sanitizeSolidIconColor } from './icon-colors'
import { RippleBg } from './showcase-card'

interface BlockInfoCardProps {
  type: string
  color: string
}

export function BlockInfoCard({ type, color }: BlockInfoCardProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const bgColor = sanitizeSolidIconColor(color)
  const IconComponent = getBlockTypeIcon(type)

  return (
    <div
      ref={containerRef}
      className='relative mb-6 overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-sm dark:bg-fd-card/50'
    >
      <RippleBg containerRef={containerRef} rows={6} />
      <div className='relative z-10 flex items-center justify-center p-8'>
        <div
          className='flex h-10 w-10 items-center justify-center rounded-md bg-fd-secondary'
          style={
            bgColor
              ? { backgroundColor: `${bgColor}20`, color: bgColor }
              : undefined
          }
        >
          <IconComponent className='h-6 w-6' />
        </div>
      </div>
    </div>
  )
}
