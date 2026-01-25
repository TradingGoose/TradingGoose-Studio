'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

type PopoverEnvironment = {
  container?: PopoverPrimitive.PortalProps['container'] | null
  scale?: number
  zIndex?: number
}

const PopoverEnvironmentContext = React.createContext<PopoverEnvironment | undefined>(undefined)

export const PopoverEnvironmentProvider = ({
  value,
  children,
}: React.PropsWithChildren<{ value: PopoverEnvironment }>) => (
  <PopoverEnvironmentContext.Provider value={value}>{children}</PopoverEnvironmentContext.Provider>
)

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  container?: PopoverPrimitive.PortalProps['container']
  scale?: number
  zIndex?: number
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      align = 'center',
      sideOffset = 4,
      container,
      scale,
      zIndex,
      style,
      ...props
    },
    ref
  ) => {
    const env = React.useContext(PopoverEnvironmentContext)
    const resolvedContainer = container ?? env?.container ?? undefined
    const resolvedZIndex = typeof zIndex === 'number' ? zIndex : env?.zIndex
    const resolvedScale = typeof scale === 'number' ? scale : env?.scale
    const shouldScale =
      typeof resolvedScale === 'number' &&
      Number.isFinite(resolvedScale) &&
      Math.abs(resolvedScale - 1) > 0.001
    const scaledStyle = shouldScale
      ? {
          scale: resolvedScale,
          transformOrigin: 'var(--radix-popper-transform-origin)',
        }
      : undefined
    const scaledSideOffset = shouldScale ? sideOffset * resolvedScale : sideOffset

    return (
      <PopoverPrimitive.Portal container={resolvedContainer ?? undefined}>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={scaledSideOffset}
          className={cn(
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
            className
          )}
          style={{
            ...style,
            ...(typeof resolvedZIndex === 'number' ? { zIndex: resolvedZIndex } : null),
            ...(scaledStyle ?? {}),
          }}
          {...props}
        />
      </PopoverPrimitive.Portal>
    )
  }
)
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverEnvironmentProvider }
