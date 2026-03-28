'use client'

import type { ReactNode, WheelEvent } from 'react'
import { useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getWidgetDefinition } from '@/widgets/registry'
import { widgetHeaderControlClassName } from '@/widgets/widgets/components/widget-header-control'

type LandingWidgetShellProps = {
  widgetKey: string
  headerLeft?: ReactNode
  headerCenter?: ReactNode
  headerRight?: ReactNode
  children: ReactNode
  className?: string
}

export function LandingWidgetShell({
  widgetKey,
  headerLeft,
  headerCenter,
  headerRight,
  children,
  className,
}: LandingWidgetShellProps) {
  const widgetDefinition = getWidgetDefinition(widgetKey) ?? getWidgetDefinition('empty')
  const WidgetIcon = widgetDefinition?.icon
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }, [])

  return (
    <div className='box-border flex h-full max-h-full min-h-[480px] w-full min-w-0 max-w-full flex-1 basis-0 p-1'>
      <Card
        className={cn(
          'flex h-full max-h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background',
          className
        )}
      >
        <header className='border-border/80 border-b bg-muted/40 text-accent-foreground'>
          <div
            onWheel={handleWheel}
            className='flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            aria-label='Widget header'
          >
            <div className='flex w-full flex-nowrap items-center gap-4 py-0.5 font-medium text-accent-foreground text-sm'>
              <div className='flex h-8 flex-grow basis-0 items-center justify-start gap-1 whitespace-nowrap pl-1 text-left'>
                <button
                  type='button'
                  className={widgetHeaderControlClassName('font-semibold')}
                  aria-label={widgetDefinition?.title ?? 'Widget'}
                >
                  <span className='flex items-center gap-1 text-muted-foreground hover:text-foreground'>
                    {WidgetIcon ? <WidgetIcon className='h-4 w-4' aria-hidden='true' /> : null}
                  </span>
                </button>
                {headerLeft ? <span className='truncate'>{headerLeft}</span> : null}
              </div>
              <div className='flex h-8 flex-grow basis-0 items-center justify-center gap-1 whitespace-nowrap text-center'>
                {headerCenter}
              </div>
              <div className='flex h-8 flex-grow basis-0 items-center justify-end gap-1 whitespace-nowrap pr-1 text-right'>
                {headerRight}
              </div>
            </div>
          </div>
        </header>
        <div className='flex flex-1 flex-col overflow-hidden'>{children}</div>
      </Card>
    </div>
  )
}
