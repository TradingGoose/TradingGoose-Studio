'use client'

import { RefreshCw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { widgetHeaderIconButtonClassName } from '@/components/widget-header-control'

type WidgetHeaderRefreshButtonProps = {
  disabled?: boolean
  label?: string
  tooltip?: string
  onClick: () => void
}

export function WidgetHeaderRefreshButton({
  disabled = false,
  label = '',
  tooltip,
  onClick,
}: WidgetHeaderRefreshButtonProps) {
  const resolvedLabel = label || tooltip || ''

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className='inline-flex'>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              onClick={onClick}
              disabled={disabled}
              aria-label={resolvedLabel}
            >
              <RefreshCw className='h-3.5 w-3.5' />
              <span className='sr-only'>{resolvedLabel}</span>
            </button>
          </span>
        }
      />
      <TooltipContent side='top'>{tooltip ?? resolvedLabel}</TooltipContent>
    </Tooltip>
  )
}
