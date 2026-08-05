'use client'

import * as React from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { cn } from '@/lib/utils'

const DropdownMenu = MenuPrimitive.Root
const DropdownMenuTrigger = MenuPrimitive.Trigger
const DropdownMenuGroup = MenuPrimitive.Group

export const dropdownMenuItemClassName =
  'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'

type DropdownMenuContentProps = MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    | 'align'
    | 'alignOffset'
    | 'collisionAvoidance'
    | 'collisionPadding'
    | 'positionMethod'
    | 'side'
    | 'sideOffset'
  > & {
    container?: MenuPrimitive.Portal.Props['container']
    portal?: boolean
    zIndex?: number
  }

const DropdownMenuContent = React.forwardRef<HTMLDivElement, DropdownMenuContentProps>(
  (
    {
      align = 'center',
      alignOffset,
      children,
      className,
      collisionAvoidance,
      collisionPadding = 8,
      container,
      portal = true,
      positionMethod,
      side = 'bottom',
      sideOffset = 4,
      zIndex = 50,
      ...props
    },
    ref
  ) => {
    const content = (
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className='isolate'
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        positionMethod={positionMethod}
        side={side}
        sideOffset={sideOffset}
        style={{ zIndex }}
      >
        <MenuPrimitive.Popup
          ref={ref}
          className={cn(
            'data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-[var(--available-height)] min-w-[8rem] origin-[var(--transform-origin)] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[ending-style]:animate-out data-[starting-style]:animate-in',
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    )

    return portal ? (
      <MenuPrimitive.Portal container={container}>{content}</MenuPrimitive.Portal>
    ) : (
      content
    )
  }
)
DropdownMenuContent.displayName = 'DropdownMenuContent'

const DropdownMenuItem = React.forwardRef<
  HTMLElement,
  MenuPrimitive.Item.Props & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <MenuPrimitive.Item
    ref={ref}
    className={cn(dropdownMenuItemClassName, inset && 'pl-8', className)}
    {...props}
  />
))
DropdownMenuItem.displayName = 'DropdownMenuItem'

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  MenuPrimitive.GroupLabel.Props & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <MenuPrimitive.GroupLabel
    ref={ref}
    className={cn('px-2 py-1.5 font-semibold text-sm', inset && 'pl-8', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = 'DropdownMenuLabel'

const DropdownMenuSeparator = React.forwardRef<HTMLDivElement, MenuPrimitive.Separator.Props>(
  ({ className, ...props }, ref) => (
    <MenuPrimitive.Separator
      ref={ref}
      className={cn('-mx-1 my-1 h-px bg-muted', className)}
      {...props}
    />
  )
)
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator'

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
}
