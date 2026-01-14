'use client'

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

type AlignValue = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>['align']
type AutoAlignValue = AlignValue | 'auto'
type SideValue = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>['side']
type AutoSideValue = SideValue | 'auto'

interface DropdownMenuContextValue {
  triggerElement: HTMLElement | null
  setTriggerElement: (node: HTMLElement | null) => void
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null)

const DropdownMenu = ({ children, ...props }: DropdownMenuPrimitive.DropdownMenuProps) => {
  const [triggerElement, setTriggerElement] = React.useState<HTMLElement | null>(null)
  const value = React.useMemo(() => ({ triggerElement, setTriggerElement }), [triggerElement])

  return (
    <DropdownMenuContext.Provider value={value}>
      <DropdownMenuPrimitive.Root {...props}>{children}</DropdownMenuPrimitive.Root>
    </DropdownMenuContext.Provider>
  )
}
DropdownMenu.displayName = 'DropdownMenu'

const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ ...props }, ref) => {
  const context = React.useContext(DropdownMenuContext)

  const handleRef = React.useCallback(
    (node: React.ElementRef<typeof DropdownMenuPrimitive.Trigger> | null) => {
      assignRef(ref, node)
      context?.setTriggerElement(node)
    },
    [ref, context]
  )

  return <DropdownMenuPrimitive.Trigger ref={handleRef} {...props} />
})
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      inset && 'pl-8',
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className='ml-auto' />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=open]:animate-in',
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    align?: AutoAlignValue
    side?: AutoSideValue
    portalled?: boolean
    portalContainer?: HTMLElement | null
  }
>(
  (
    {
      className,
      sideOffset = 4,
      avoidCollisions = false,
      sticky = 'always',
      align = 'auto',
      side = 'auto',
      portalled = true,
      portalContainer,
      ...props
    },
    ref
  ) => {
    const context = React.useContext(DropdownMenuContext)
    const resolvedAlign = useDropdownAutoAlign(context?.triggerElement ?? null, align)
    const resolvedSide = useDropdownAutoSide(context?.triggerElement ?? null, side)
    const contentAlign: AlignValue | undefined =
      resolvedAlign === 'center' ? undefined : resolvedAlign

    const content = (
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        avoidCollisions={avoidCollisions}
        sticky={sticky as any}
        align={contentAlign}
        side={resolvedSide}
        className={cn(
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=closed]:animate-out data-[state=open]:animate-in',
          className
        )}
        {...props}
      />
    )

    if (!portalled) {
      return content
    }

    return <DropdownMenuPrimitive.Portal container={portalContainer}>{content}</DropdownMenuPrimitive.Portal>
  }
)
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    checked={checked}
    {...props}
  >
    <span className='absolute left-2 flex h-3.5 w-3.5 items-center justify-center'>
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className='h-4 w-4' />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <span className='absolute left-2 flex h-3.5 w-3.5 items-center justify-center'>
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className='h-2 w-2 fill-current' />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 font-semibold text-sm', inset && 'pl-8', className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-muted', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...props} />
}
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut'

function useDropdownAutoAlign(
  triggerElement: HTMLElement | null,
  align: AutoAlignValue
): AlignValue {
  const [computedAlign, setComputedAlign] = React.useState<AlignValue>('center')
  const alignPreference = align ?? 'center'

  React.useEffect(() => {
    if (alignPreference !== 'auto') {
      setComputedAlign(alignPreference as AlignValue)
      return
    }

    if (!triggerElement) {
      setComputedAlign('center')
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    const updateAlignment = () => {
      if (!triggerElement) return
      const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0
      if (!viewportWidth) {
        setComputedAlign('center')
        return
      }
      const rect = triggerElement.getBoundingClientRect()
      const triggerCenter = rect.left + rect.width / 2
      const ratio = triggerCenter / viewportWidth

      if (ratio < 0.3) {
        setComputedAlign('start')
      } else if (ratio > 0.7) {
        setComputedAlign('end')
      } else {
        setComputedAlign('center')
      }
    }

    updateAlignment()
    window.addEventListener('resize', updateAlignment)
    window.addEventListener('scroll', updateAlignment, true)
    return () => {
      window.removeEventListener('resize', updateAlignment)
      window.removeEventListener('scroll', updateAlignment, true)
    }
  }, [alignPreference, triggerElement])

  return alignPreference === 'auto' ? computedAlign : (alignPreference as AlignValue)
}

function useDropdownAutoSide(triggerElement: HTMLElement | null, side: AutoSideValue): SideValue {
  const [computedSide, setComputedSide] = React.useState<SideValue>('bottom')
  const sidePreference = side ?? 'auto'

  React.useEffect(() => {
    if (sidePreference !== 'auto') {
      setComputedSide(sidePreference as SideValue)
      return
    }

    if (!triggerElement) {
      setComputedSide('bottom')
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    const updateSide = () => {
      if (!triggerElement) {
        setComputedSide('bottom')
        return
      }

      const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
      if (!viewportHeight) {
        setComputedSide('bottom')
        return
      }

      const rect = triggerElement.getBoundingClientRect()
      const spaceAbove = rect.top
      const spaceBelow = viewportHeight - rect.bottom

      setComputedSide(spaceBelow >= spaceAbove ? 'bottom' : 'top')
    }

    updateSide()
    window.addEventListener('resize', updateSide)
    window.addEventListener('scroll', updateSide, true)
    return () => {
      window.removeEventListener('resize', updateSide)
      window.removeEventListener('scroll', updateSide, true)
    }
  }, [sidePreference, triggerElement])

  return sidePreference === 'auto' ? computedSide : (sidePreference as SideValue)
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return
  }
  if (typeof ref === 'function') {
    ref(value)
  } else {
    ; (ref as React.MutableRefObject<T | null>).current = value
  }
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
