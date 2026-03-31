import * as React from 'react'

import { cn } from '@/lib/utils'

interface MarqueeProps extends React.ComponentPropsWithoutRef<'div'> {
  children: React.ReactNode
  className?: string
  duration?: number
  delay?: number
  gap?: number
  pauseOnHover?: boolean
  repeat?: number
  reverse?: boolean
  vertical?: boolean
}

function Marquee(props: MarqueeProps) {
  const {
    children,
    className,
    duration = 40,
    delay = 0,
    gap = 1,
    pauseOnHover = false,
    repeat = 2,
    reverse = false,
    vertical = false,
    ...rest
  } = props

  return (
    <div
      className={cn(
        'group flex overflow-hidden p-3',
        {
          'flex-row': !vertical,
          'flex-col': vertical
        },
        className
      )}
      style={
        {
          gap: `${gap}rem`,
          '--gap': `${gap}rem`,
          '--duration': `${duration}s`,
        } as React.CSSProperties
      }
      {...rest}
    >
      {Array(repeat)
        .fill(0)
        .map((_, i) => (
          <div
            key={i}
            className={cn('flex shrink-0 justify-around', {
              'flex-row animate-marquee': !vertical,
              'flex-col animate-marquee-vertical': vertical,
              'group-hover:[animation-play-state:paused]': pauseOnHover,
              '[animation-direction:reverse]': reverse,
            })}
            style={{
              gap: `${gap}rem`,
              animationDelay: `${delay}s`,
            }}
          >
            {children}
          </div>
        ))}
    </div>
  )
}

export { Marquee, type MarqueeProps }
