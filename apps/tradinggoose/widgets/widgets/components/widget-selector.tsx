'use client'

import { cloneElement, isValidElement, memo, type ReactElement, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getWidgetCategories, getWidgetDefinition } from '@/widgets/registry'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

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
      <span className='flex items-center gap-1 text-muted-foreground hover:text-foreground'>
        <span className=' '>
          {CurrentIcon ? <CurrentIcon className='h-4 w-4 ' aria-hidden='true' /> : null}
        </span>
        <ChevronDown className='h-4 w-4 ' aria-hidden='true' />
      </span>
    </button>
  )

  const customTrigger = renderTrigger
    ? renderTrigger({ disabled: triggerDisabled, currentDefinition })
    : null

  const triggerContent = customTrigger ?? defaultTrigger
  const triggerElement = isValidElement<TriggerElementProps>(triggerContent)
    ? cloneElement(triggerContent, {
        disabled: triggerDisabled || triggerContent.props.disabled,
        'aria-disabled': triggerDisabled || triggerContent.props.disabled ? true : undefined,
      })
    : triggerContent

  const tooltipText = triggerDisabled ? 'Widget selection unavailable' : 'Select widget'

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>{triggerElement}</DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-[540px] max-w-[calc(100vw-2rem)] p-2')}
      >
        <div className='grid grid-cols-3'>
          {categories.map((category) => {
            const visibleWidgets = category.widgets.filter((widget) => widget.key !== 'empty')
            if (visibleWidgets.length === 0) return null

            return (
              <div key={category.key} className=''>
                <div>
                  <p className='font-semibold text-xs uppercase tracking-wide '>{category.title}</p>
                </div>
                <div className='space-y-1'>
                  {visibleWidgets.map((widget) => (
                    <DropdownMenuItem
                      key={widget.key}
                      className={cn(widgetHeaderMenuItemClassName, 'items-start items-center')}
                      onSelect={() => {
                        if (!onSelect || widget.key === currentKey) return
                        onSelect(widget.key)
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
            )
          })}
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
