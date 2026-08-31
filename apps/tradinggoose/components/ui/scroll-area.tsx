'use client'

import * as React from 'react'
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import { cn } from '@/lib/utils'

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  ScrollAreaPrimitive.Root.Props & {
    hideScrollbar?: boolean
    viewportClassName?: string
  }
>(({ className, children, hideScrollbar = false, viewportClassName, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    data-slot='scroll-area'
    ref={ref}
    className={cn('relative overflow-hidden', className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      data-slot='scroll-area-viewport'
      className={cn('h-full w-full rounded-[inherit]', viewportClassName)}
    >
      <ScrollAreaPrimitive.Content data-slot='scroll-area-content'>
        {children}
      </ScrollAreaPrimitive.Content>
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar hidden={hideScrollbar} />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = 'ScrollArea'

const ScrollBar = React.forwardRef<
  HTMLDivElement,
  ScrollAreaPrimitive.Scrollbar.Props & {
    hidden?: boolean
  }
>(({ className, orientation = 'vertical', hidden = false, ...props }, ref) => (
  <ScrollAreaPrimitive.Scrollbar
    data-slot='scroll-area-scrollbar'
    data-orientation={orientation}
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2.5 data-[orientation=vertical]:border-l data-[orientation=vertical]:border-l-transparent data-[orientation=vertical]:p-[1px]',
      'data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-t data-[orientation=horizontal]:border-t-transparent data-[orientation=horizontal]:p-[1px]',
      hidden && 'pointer-events-none w-0 border-0 p-0 opacity-0',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.Thumb
      data-slot='scroll-area-thumb'
      className={cn('relative flex-1 rounded-full bg-border', hidden && 'hidden')}
    />
  </ScrollAreaPrimitive.Scrollbar>
))
ScrollBar.displayName = 'ScrollBar'

export { ScrollArea }
