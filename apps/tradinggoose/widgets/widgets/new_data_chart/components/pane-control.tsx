'use client'

import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type PaneControlProps = {
  paneIndex: number
  paneCount: number
  isCollapsed: boolean
  isMaximized: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onToggleCollapse: () => void
  onToggleMaximize: () => void
}

const buttonClass =
  'inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50'

export const PaneControl = ({
  paneIndex,
  paneCount,
  isCollapsed,
  isMaximized,
  onMoveUp,
  onMoveDown,
  onToggleCollapse,
  onToggleMaximize,
}: PaneControlProps) => {
  const disableMoveUp = paneIndex <= 0
  const disableMoveDown = paneIndex >= paneCount - 1
  const disableResizeActions = paneCount < 2

  return (
    <div className='flex items-center gap-1'>
      <button
        type='button'
        className={buttonClass}
        onClick={onMoveUp}
        disabled={disableMoveUp}
        title='Move up'
      >
        <ChevronUp className='h-3.5 w-3.5' />
        <span className='sr-only'>Move pane up</span>
      </button>
      <button
        type='button'
        className={buttonClass}
        onClick={onMoveDown}
        disabled={disableMoveDown}
        title='Move down'
      >
        <ChevronDown className='h-3.5 w-3.5' />
        <span className='sr-only'>Move pane down</span>
      </button>
      <button
        type='button'
        className={cn(buttonClass, isCollapsed && 'text-foreground')}
        onClick={onToggleCollapse}
        disabled={disableResizeActions}
        title={isCollapsed ? 'Restore' : 'Collapse'}
      >
        {isCollapsed ? (
          <ChevronsUpDown className='h-3.5 w-3.5' />
        ) : (
          <ChevronsDownUp className='h-3.5 w-3.5' />
        )}
        <span className='sr-only'>{isCollapsed ? 'Restore pane' : 'Collapse pane'}</span>
      </button>
      <button
        type='button'
        className={cn(buttonClass, isMaximized && 'text-foreground')}
        onClick={onToggleMaximize}
        disabled={disableResizeActions}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <Minimize2 className='h-3.5 w-3.5' />
        ) : (
          <Maximize2 className='h-3.5 w-3.5' />
        )}
        <span className='sr-only'>{isMaximized ? 'Restore pane' : 'Maximize pane'}</span>
      </button>
    </div>
  )
}
