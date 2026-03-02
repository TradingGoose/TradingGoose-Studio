'use client'

import { ArrowUpDown, Download, Eraser, FileUp, ListChecks, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuItemClassName,
} from '@/widgets/widgets/components/widget-header-control'

type WatchlistListActionsButtonProps = {
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  disabled?: boolean
  importDisabled?: boolean
  exportDisabled?: boolean
  clearListDisabled?: boolean
  resetOrderDisabled?: boolean
  deleteWatchlistDisabled?: boolean
  onImport: () => void
  onExport: () => void
  onClearList: () => void
  onResetOrder: () => void
  onDeleteWatchlist: () => void
}

export const WatchlistListActionsButton = ({
  open,
  onOpenChange,
  disabled = false,
  importDisabled = false,
  exportDisabled = false,
  clearListDisabled = false,
  resetOrderDisabled = false,
  deleteWatchlistDisabled = false,
  onImport,
  onExport,
  onClearList,
  onResetOrder,
  onDeleteWatchlist,
}: WatchlistListActionsButtonProps) => {
  const closeAndRun = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={widgetHeaderControlClassName('gap-1.5')}
                disabled={disabled}
              >
                <ListChecks className='h-3.5 w-3.5 text-muted-foreground' />
                <span>List actions</span>
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>List actions</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-52 p-1'>
        <button
          type='button'
          className={widgetHeaderMenuItemClassName}
          onClick={() => closeAndRun(onImport)}
          disabled={importDisabled}
        >
          <FileUp className='h-3.5 w-3.5' />
          <span>Import</span>
        </button>
        <button
          type='button'
          className={widgetHeaderMenuItemClassName}
          onClick={() => closeAndRun(onExport)}
          disabled={exportDisabled}
        >
          <Download className='h-3.5 w-3.5' />
          <span>Export</span>
        </button>
        <button
          type='button'
          className={widgetHeaderMenuItemClassName}
          onClick={() => closeAndRun(onClearList)}
          disabled={clearListDisabled}
        >
          <Eraser className='h-3.5 w-3.5' />
          <span>Clear list</span>
        </button>
        <button
          type='button'
          className={widgetHeaderMenuItemClassName}
          onClick={() => closeAndRun(onResetOrder)}
          disabled={resetOrderDisabled}
        >
          <ArrowUpDown className='h-3.5 w-3.5' />
          <span>Reset order</span>
        </button>
        <button
          type='button'
          className={widgetHeaderMenuItemClassName}
          onClick={() => closeAndRun(onDeleteWatchlist)}
          disabled={deleteWatchlistDisabled}
        >
          <Trash2 className='h-3.5 w-3.5' />
          <span>Delete watchlist</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}
