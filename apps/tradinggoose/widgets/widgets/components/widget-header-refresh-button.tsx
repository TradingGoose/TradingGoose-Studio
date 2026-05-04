'use client'

import { RefreshCw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'

type WidgetHeaderRefreshButtonProps = {
  disabled?: boolean
  label?: string
  tooltip?: string
  onClick: () => void
}

export function WidgetHeaderRefreshButton({
  disabled = false,
  label = 'Refresh data',
  tooltip,
  onClick,
}: WidgetHeaderRefreshButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          >
            <RefreshCw className='h-3.5 w-3.5' />
            <span className='sr-only'>{label}</span>
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}
