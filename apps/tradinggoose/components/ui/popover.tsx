'use client'

import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

type PopoverPortalProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Portal>

type PopoverEnvironment = {
  container?: PopoverPortalProps['container']
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

type PopoverPositionerProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Positioner>
type PopoverPopupProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup>

type PopoverContentProps = Omit<PopoverPopupProps, 'className' | 'style'> &
  Pick<
    PopoverPositionerProps,
    | 'align'
    | 'alignOffset'
    | 'anchor'
    | 'collisionAvoidance'
    | 'collisionBoundary'
    | 'collisionPadding'
    | 'positionMethod'
    | 'side'
    | 'sideOffset'
    | 'sticky'
  > & {
    className?: string
    container?: PopoverPortalProps['container']
    scale?: number
    style?: React.CSSProperties
    zIndex?: number
  }

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Popup>,
  PopoverContentProps
>(
  (
    {
      align = 'center',
      alignOffset,
      anchor,
      className,
      collisionAvoidance,
      collisionBoundary,
      collisionPadding = 8,
      container,
      positionMethod,
      scale,
      side = 'bottom',
      sideOffset = 4,
      sticky,
      style,
      zIndex,
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
          transformOrigin: 'var(--transform-origin)',
        }
      : undefined
    const scaledSideOffset =
      shouldScale && typeof sideOffset === 'number' ? sideOffset * resolvedScale : sideOffset

    return (
      <PopoverPrimitive.Portal container={resolvedContainer ?? undefined}>
        <PopoverPrimitive.Positioner
          align={align}
          alignOffset={alignOffset}
          anchor={anchor}
          className='pointer-events-auto isolate z-50'
          collisionAvoidance={collisionAvoidance}
          collisionBoundary={collisionBoundary}
          collisionPadding={collisionPadding}
          positionMethod={positionMethod}
          side={side}
          sideOffset={scaledSideOffset}
          sticky={sticky}
          style={typeof resolvedZIndex === 'number' ? { zIndex: resolvedZIndex } : undefined}
        >
          <PopoverPrimitive.Popup
            ref={ref}
            className={cn(
              'data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-72 origin-[var(--transform-origin)] rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[ending-style]:animate-out data-[starting-style]:animate-in',
              className
            )}
            style={{ ...style, ...(scaledStyle ?? {}) }}
            {...props}
          />
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    )
  }
)
PopoverContent.displayName = 'PopoverContent'

export { Popover, PopoverTrigger, PopoverContent }
