'use client'

import { type ReactNode, useRef } from 'react'
import { RippleBg } from './showcase-card'
import { blockTypeToIconMap } from './icon-mapping'

interface BlockInfoCardProps {
  type: string
  color: string
  icon?: boolean
  iconSvg?: string
}

export function BlockInfoCard({
  type,
  color,
  icon = false,
  iconSvg,
}: BlockInfoCardProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const bgColor = color && color.length > 1 ? color : undefined

  // Resolve icon: prefer mapped React component, fall back to SVG string
  const IconComponent = blockTypeToIconMap[type] || null

  return (
    <div
      ref={containerRef}
      className='relative mb-6 overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-sm dark:bg-fd-card/50'
    >
      <RippleBg containerRef={containerRef} rows={6} />
      <div className='relative z-10 flex items-center justify-center p-8'>
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-xl shadow-md ${!bgColor ? 'bg-fd-secondary' : ''}`}
          style={bgColor ? { backgroundColor: bgColor } : undefined}
        >
          {IconComponent ? (
            <IconComponent className={`h-8 w-8 ${bgColor ? 'text-white' : 'text-fd-foreground'}`} />
          ) : iconSvg ? (
            <div className={`h-8 w-8 ${bgColor ? 'text-white' : 'text-fd-foreground'}`} dangerouslySetInnerHTML={{ __html: iconSvg }} />
          ) : (
            <div className='font-mono text-2xl font-bold text-fd-muted-foreground'>
              {type.substring(0, 1).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
