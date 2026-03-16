'use client'

import type { ReactNode } from 'react'
import { Download, Eraser, FileUp, ListPlus, Plus, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuItemClassName,
} from '@/widgets/widgets/components/widget-header-control'

type WatchlistListActionsButtonProps = {
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  disabled?: boolean
  addSymbolDisabled?: boolean
  createWatchlistDisabled?: boolean
  createSectionDisabled?: boolean
  importDisabled?: boolean
  exportDisabled?: boolean
  clearListDisabled?: boolean
  deleteWatchlistDisabled?: boolean
  onAddSymbol: () => void
  onCreateWatchlist: () => void
  onCreateSection: () => void
  onImport: () => void
  onExport: () => void
  onClearList: () => void
  onDeleteWatchlist: () => void
}

type VisibleAction = {
  key: string
  icon: ReactNode
  label: string
  onClick: () => void
}

export const WatchlistListActionsButton = ({
  open,
  onOpenChange,
  disabled = false,
  addSymbolDisabled = false,
  createWatchlistDisabled = false,
  createSectionDisabled = false,
  importDisabled = false,
  exportDisabled = false,
  clearListDisabled = false,
  deleteWatchlistDisabled = false,
  onAddSymbol,
  onCreateWatchlist,
  onCreateSection,
  onImport,
  onExport,
  onClearList,
  onDeleteWatchlist,
}: WatchlistListActionsButtonProps) => {
  const closeAndRun = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  const visibleActions: VisibleAction[] = []

  if (!addSymbolDisabled) {
    visibleActions.push({
      key: 'add-symbol',
      icon: <ListPlus className='h-3.5 w-3.5' />,
      label: 'Add Symbol',
      onClick: () => closeAndRun(onAddSymbol),
    })
  }

  if (!createWatchlistDisabled) {
    visibleActions.push({
      key: 'create-watchlist',
      icon: <Plus className='h-3.5 w-3.5' />,
      label: 'Create Watchlist',
      onClick: () => closeAndRun(onCreateWatchlist),
    })
  }

  if (!createSectionDisabled) {
    visibleActions.push({
      key: 'create-section',
      icon: <ListPlus className='h-3.5 w-3.5' />,
      label: 'Create Section',
      onClick: () => closeAndRun(onCreateSection),
    })
  }

  if (!importDisabled) {
    visibleActions.push({
      key: 'import',
      icon: <FileUp className='h-3.5 w-3.5' />,
      label: 'Import',
      onClick: () => closeAndRun(onImport),
    })
  }

  if (!exportDisabled) {
    visibleActions.push({
      key: 'export',
      icon: <Download className='h-3.5 w-3.5' />,
      label: 'Export',
      onClick: () => closeAndRun(onExport),
    })
  }

  if (!clearListDisabled) {
    visibleActions.push({
      key: 'clear-list',
      icon: <Eraser className='h-3.5 w-3.5' />,
      label: 'Clear list',
      onClick: () => closeAndRun(onClearList),
    })
  }

  if (!deleteWatchlistDisabled) {
    visibleActions.push({
      key: 'delete-watchlist',
      icon: <Trash2 className='h-3.5 w-3.5' />,
      label: 'Delete watchlist',
      onClick: () => closeAndRun(onDeleteWatchlist),
    })
  }

  const triggerDisabled = disabled || visibleActions.length === 0

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                disabled={triggerDisabled}
              >
                <Plus className='h-3.5 w-3.5' />
                <span className='sr-only'>List actions</span>
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>List actions</TooltipContent>
      </Tooltip>
      {visibleActions.length > 0 ? (
        <PopoverContent
          align='end'
          className='w-56 p-1'
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {visibleActions.map((action) => (
            <button
              key={action.key}
              type='button'
              className={widgetHeaderMenuItemClassName}
              onClick={action.onClick}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </PopoverContent>
      ) : null}
    </Popover>
  )
}
