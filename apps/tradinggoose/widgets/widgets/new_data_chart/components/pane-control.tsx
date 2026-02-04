'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type PaneControlProps = {
  paneIndex: number
  paneCount: number
  onMoveUp: () => void
  onMoveDown: () => void
}

const buttonClass =
  'inline-flex p-0.5 items-center hover:bg-secondary justify-center rounded-xs bg-background text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50'

export const PaneControl = ({
  paneIndex,
  paneCount,
  onMoveUp,
  onMoveDown,
}: PaneControlProps) => {
  const disableMoveUp = paneIndex <= 0
  const disableMoveDown = paneIndex >= paneCount - 1

  return (
    <div className='inline-flex min-w-0 max-w-full self-start items-center h-6 gap-1 rounded-sm border border-border/40 text-center text-xs shadow-xs bg-background/40 backdrop-blur-sm hover:bg-background'>
      <div className=' items-center gap-1 p-0.5 flex' >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className={buttonClass}
              onClick={onMoveUp}
              disabled={disableMoveUp}
            >
              <ChevronUp className='h-3 w-3' />
              <span className='sr-only'>Move pane up</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='top'>Move up</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className={buttonClass}
              onClick={onMoveDown}
              disabled={disableMoveDown}
            >
              <ChevronDown className='h-3 w-3' />
              <span className='sr-only'>Move pane down</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='top'>Move down</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
