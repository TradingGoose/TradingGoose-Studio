'use client'

import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { dropdownMenuItemClassName } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

type StaticClassNameProps<Props> = Omit<Props, 'className'> & { className?: string }

export function selectTriggerClassName(className?: string) {
  return cn(
    'group flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
    className
  )
}

type SelectTriggerProps = StaticClassNameProps<SelectPrimitive.Trigger.Props>

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger ref={ref} className={selectTriggerClassName(className)} {...props}>
      {children}
      <ChevronDown className='h-4 w-4 opacity-50 transition-transform duration-200 ease-in-out group-data-[popup-open]:rotate-180' />
    </SelectPrimitive.Trigger>
  )
)
SelectTrigger.displayName = 'SelectTrigger'

type SelectContentProps = StaticClassNameProps<SelectPrimitive.Popup.Props> &
  Pick<
    SelectPrimitive.Positioner.Props,
    | 'align'
    | 'alignOffset'
    | 'collisionAvoidance'
    | 'collisionPadding'
    | 'positionMethod'
    | 'side'
    | 'sideOffset'
  >

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  (
    {
      align = 'center',
      alignOffset,
      children,
      className,
      collisionAvoidance,
      collisionPadding = 8,
      positionMethod,
      side = 'bottom',
      sideOffset = 4,
      ...props
    },
    ref
  ) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={false}
        alignOffset={alignOffset}
        className='isolate z-50'
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        positionMethod={positionMethod}
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          ref={ref}
          className={cn(
            'relative min-w-[8rem] origin-[var(--transform-origin)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[ending-style]:animate-out data-[starting-style]:animate-in',
            className
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className='absolute inset-x-0 top-0 z-10 flex cursor-default items-center justify-center bg-popover py-1'>
            <ChevronUp className='h-4 w-4 opacity-70 transition-opacity hover:opacity-100' />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List className='scrollbar-thin max-h-[min(24rem,var(--available-height))] min-w-[var(--anchor-width)] overscroll-contain overflow-y-auto p-1 scrollbar-track-transparent scrollbar-thumb-slate-200'>
            {children}
          </SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow className='absolute inset-x-0 bottom-0 z-10 flex cursor-default items-center justify-center bg-popover py-1'>
            <ChevronDown className='h-4 w-4 opacity-70 transition-opacity hover:opacity-100' />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
)
SelectContent.displayName = 'SelectContent'

const SelectLabel = React.forwardRef<
  HTMLDivElement,
  StaticClassNameProps<SelectPrimitive.GroupLabel.Props>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.GroupLabel
    ref={ref}
    className={cn('py-1.5 pr-2 pl-8 font-semibold text-sm', className)}
    {...props}
  />
))
SelectLabel.displayName = 'SelectLabel'

const SelectItem = React.forwardRef<HTMLElement, StaticClassNameProps<SelectPrimitive.Item.Props>>(
  ({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(dropdownMenuItemClassName, 'w-full', className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className='ml-auto flex h-3.5 w-3.5 items-center justify-center'>
        <SelectPrimitive.ItemIndicator>
          <Check className='h-4 w-4' />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
)
SelectItem.displayName = 'SelectItem'

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue }
