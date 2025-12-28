'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

type TooltipEnvironment = {
  container?: TooltipPrimitive.PortalProps['container'] | null
  scale?: number
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

type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
  command?: string
  commandPosition?: 'inline' | 'below'
  container?: TooltipPrimitive.PortalProps['container']
  scale?: number
}

const TooltipContent = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Content>, TooltipContentProps>(
  ({ className, sideOffset = 8, command, commandPosition = 'inline', container, scale, style, ...props }, ref) => {
    const env = React.useContext(TooltipEnvironmentContext)
    const resolvedContainer = container ?? env?.container ?? undefined
    const resolvedScale = scale ?? env?.scale

    const shouldScale =
      typeof resolvedScale === 'number' && Number.isFinite(resolvedScale) && Math.abs(resolvedScale - 1) > 0.001
    const scaledStyle = shouldScale
      ? {
          fontSize: `${12 * resolvedScale}px`, // text-xs ≈ 12px
          padding: `${6 * resolvedScale}px ${12 * resolvedScale}px`, // py-1.5 px-3
          borderRadius: `${4 * resolvedScale}px`,
          lineHeight: 1.4,
          width: 'max-content',
          maxWidth: 'max-content',
          whiteSpace: 'nowrap',
        }
      : undefined

    return (
      <TooltipPrimitive.Portal container={resolvedContainer ?? undefined}>
        <TooltipPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          className={cn(
            'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark: z-[60] animate-in overflow-hidden rounded-xs bg-black px-3 py-1.5 text-white text-xs shadow-md data-[state=closed]:animate-out dark:text-black dark:bg-white',
            className
          )}
          style={{
            ...style,
            ...(scaledStyle ?? {}),
          }}
          {...props}
        >
          {props.children}
          {command && commandPosition === 'inline' && (
            <span className='pl-2 text-white/80 dark:text-black/70'>{command}</span>
          )}
          {command && commandPosition === 'below' && (
            <div className='pt-[1px] text-white/80 dark:text-black/70'>{command}</div>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    )
  }
)
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipEnvironmentProvider }
