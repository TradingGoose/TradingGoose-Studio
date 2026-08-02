'use client'

import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from '@/lib/utils'

type TooltipPortalProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Portal>

type TooltipEnvironment = {
  container?: TooltipPortalProps['container']
}

const TooltipEnvironmentContext = React.createContext<TooltipEnvironment | undefined>(undefined)

export const TooltipEnvironmentProvider = ({
  value,
  children,
}: React.PropsWithChildren<{ value: TooltipEnvironment }>) => (
  <TooltipEnvironmentContext.Provider value={value}>{children}</TooltipEnvironmentContext.Provider>
)

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

type TooltipPositionerProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>
type TooltipPopupProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Popup>

type TooltipContentProps = Omit<TooltipPopupProps, 'className' | 'style'> &
  Pick<TooltipPositionerProps, 'align' | 'collisionAvoidance' | 'side' | 'sideOffset'> & {
    command?: string
    container?: TooltipPortalProps['container']
    zIndex?: number
    className?: string
    style?: React.CSSProperties
  }

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Popup>,
  TooltipContentProps
>(
  (
    {
      align,
      className,
      collisionAvoidance,
      command,
      container,
      side,
      sideOffset = 8,
      style,
      zIndex,
      ...props
    },
    ref
  ) => {
    const env = React.useContext(TooltipEnvironmentContext)
    const resolvedContainer = container ?? env?.container ?? undefined

    return (
      <TooltipPrimitive.Portal container={resolvedContainer ?? undefined}>
        <TooltipPrimitive.Positioner
          align={align}
          className='isolate z-[60]'
          collisionAvoidance={collisionAvoidance}
          side={side}
          sideOffset={sideOffset}
          style={zIndex === undefined ? undefined : { zIndex }}
        >
          <TooltipPrimitive.Popup
            ref={ref}
            className={cn(
              'data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 overflow-hidden rounded-xs bg-black px-3 py-1.5 text-white text-xs shadow-md data-[ending-style]:animate-out data-[starting-style]:animate-in dark:bg-white dark:text-black',
              className
            )}
            style={style}
            {...props}
          >
            {props.children}
            {command && <span className='pl-2 text-white/80 dark:text-black/70'>{command}</span>}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    )
  }
)
TooltipContent.displayName = TooltipPrimitive.Popup.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
