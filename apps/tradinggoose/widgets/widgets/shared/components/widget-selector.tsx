'use client'

import {
  cloneElement,
  isValidElement,
  type MouseEvent,
  memo,
  type ReactElement,
  useMemo,
  useState,
} from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/shared/components/widget-header-control'
import { getWidgetCategories, getWidgetDefinition } from '@/widgets/registry'
import type { DashboardWidgetDefinition } from '@/widgets/types'

interface WidgetSelectorProps {
  currentKey?: string | null
  onSelect?: (widgetKey: string) => void
  disabled?: boolean
  renderTrigger?: (options: {
    disabled: boolean
    currentDefinition?: DashboardWidgetDefinition
  }) => ReactElement
}

type TriggerElementProps = {
  disabled?: boolean
  'aria-disabled'?: boolean
  onMouseEnter?: (event: MouseEvent) => void
  onMouseLeave?: (event: MouseEvent) => void
}

const categories = getWidgetCategories()

function WidgetSelectorComponent({
  currentKey,
  onSelect,
  disabled,
  renderTrigger,
}: WidgetSelectorProps) {
  const currentDefinition: DashboardWidgetDefinition | undefined = useMemo(() => {
    if (!currentKey) return getWidgetDefinition('empty')
    return getWidgetDefinition(currentKey) ?? getWidgetDefinition('empty')
  }, [currentKey])

  const CurrentIcon = currentDefinition?.icon
  const triggerDisabled = Boolean(disabled)

  const defaultTrigger = (
    <button
      type='button'
      disabled={triggerDisabled}
      className={widgetHeaderControlClassName('font-semibold')}
    >
      <span className='flex items-center gap-2 text-muted-foreground hover:text-foreground'>
        <span className=' '>
          {CurrentIcon ? <CurrentIcon className='h-3.5 w-3.5 ' aria-hidden='true' /> : null}
        </span>
        <ChevronDown className='h-3.5 w-3.5 ' aria-hidden='true' />
      </span>
    </button>
  )

  const customTrigger = renderTrigger
    ? renderTrigger({ disabled: triggerDisabled, currentDefinition })
    : null

  const [open, setOpen] = useState(false)
  const closeMenu = () => setOpen(false)

  const triggerContent = customTrigger ?? defaultTrigger
  const triggerElement = isValidElement<TriggerElementProps>(triggerContent)
    ? cloneElement(triggerContent, {
      disabled: triggerDisabled || triggerContent.props.disabled,
      'aria-disabled': triggerDisabled || triggerContent.props.disabled ? true : undefined,
      onClick: (event: MouseEvent) => {
        triggerContent.props.onClick?.(event)
        if (!triggerDisabled) {
          setOpen((prev) => !prev)
        }
      },
    })
    : triggerContent

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{triggerElement}</DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={6}
        className={cn(
          widgetHeaderMenuContentClassName,
          'w-[540px] max-w-[calc(100vw-2rem)] p-2'
        )}
      >
        <div className='grid grid-cols-3'>
          {categories.map((category) => (
            <div key={category.key} className=''>
              <div>
                <p className='font-semibold text-xs uppercase tracking-wide '>{category.title}</p>
              </div>
              <div className='space-y-1'>
                {category.widgets.map((widget) => (
                  <DropdownMenuItem
                    key={widget.key}
                    className={cn(widgetHeaderMenuItemClassName, 'items-start')}
                    onSelect={(event) => {
                      event.preventDefault()
                      if (!onSelect || widget.key === currentKey) return
                      onSelect(widget.key)
                      closeMenu()
                    }}
                  >
                    <widget.icon className={widgetHeaderMenuIconClassName} aria-hidden='true' />
                    <div className='space-y-0.5'>
                      <p className={widgetHeaderMenuTextClassName}>{widget.title}</p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function areWidgetSelectorPropsEqual(prev: WidgetSelectorProps, next: WidgetSelectorProps) {
  return (
    prev.currentKey === next.currentKey &&
    prev.disabled === next.disabled &&
    prev.onSelect === next.onSelect &&
    prev.renderTrigger === next.renderTrigger
  )
}

export const WidgetSelector = memo(WidgetSelectorComponent, areWidgetSelectorPropsEqual)
