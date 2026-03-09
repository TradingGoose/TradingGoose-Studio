'use client'

import { RefreshCw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'

type WatchlistRefreshDataButtonProps = {
  disabled?: boolean
  onClick: () => void
}

export const WatchlistRefreshDataButton = ({
  disabled = false,
  onClick,
}: WatchlistRefreshDataButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type='button'
        className={widgetHeaderIconButtonClassName()}
        onClick={onClick}
        disabled={disabled}
      >
        <RefreshCw className='h-3.5 w-3.5' />
        <span className='sr-only'>Refresh data</span>
      </button>
    </TooltipTrigger>
    <TooltipContent side='top'>Refresh data</TooltipContent>
  </Tooltip>
)
