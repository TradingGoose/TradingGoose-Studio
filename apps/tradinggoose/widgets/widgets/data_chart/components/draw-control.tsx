'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DRAW_ACTION_ICONS,
} from '@/widgets/widgets/data_chart/components/draw-tool-icon-registry'
import {
  getDataChartDrawActionLabel,
  useDataChartCopy,
} from '@/widgets/widgets/data_chart/copy'

type DrawControlProps = {
  onHideSelected: () => void
  onRemoveSelected: () => void
  disabled?: boolean
}

const buttonClass =
  'inline-flex p-0.5 items-center hover:bg-secondary justify-center rounded-xs bg-background text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50'

export const DrawControl = ({ onHideSelected, onRemoveSelected, disabled = false }: DrawControlProps) => {
  const copy = useDataChartCopy()
  const HideIcon = DRAW_ACTION_ICONS.hideSelected
  const RemoveIcon = DRAW_ACTION_ICONS.removeSelected
  const hideSelectedLabel = getDataChartDrawActionLabel(copy, 'hideSelected')
  const removeSelectedLabel = getDataChartDrawActionLabel(copy, 'removeSelected')

  return (
    <div className='inline-flex min-w-0 max-w-full self-start items-center h-6 gap-1 rounded-sm border border-border/40 text-center text-xs shadow-xs bg-background/40 backdrop-blur-sm hover:bg-background'>
      <div className='items-center gap-1 p-0.5 flex'>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className={buttonClass}
              onClick={onHideSelected}
              disabled={disabled}
            >
              <HideIcon className='h-3 w-3' />
              <span className='sr-only'>{hideSelectedLabel}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='top'>{hideSelectedLabel}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className={buttonClass}
              onClick={onRemoveSelected}
              disabled={disabled}
            >
              <RemoveIcon className='h-3 w-3' />
              <span className='sr-only'>{removeSelectedLabel}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='top'>{removeSelectedLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
