'use client'

import type { ReactNode } from 'react'
import { Download, FileUp, FolderPlus, ListPlus, Plus } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMessages } from 'next-intl'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuItemClassName,
} from '@/components/widget-header-control'

type WatchlistListActionsButtonProps = {
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  disabled?: boolean
  createListDisabled?: boolean
  createSectionDisabled?: boolean
  importDisabled?: boolean
  exportDisabled?: boolean
  onCreateList: () => void
  onCreateSection: () => void
  onImport: () => void
  onExport: () => void
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
  createListDisabled = false,
  createSectionDisabled = false,
  importDisabled = false,
  exportDisabled = false,
  onCreateList,
  onCreateSection,
  onImport,
  onExport,
}: WatchlistListActionsButtonProps) => {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.watchlist.header
  const closeAndRun = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  const visibleActions: VisibleAction[] = []

  if (!createListDisabled) {
    visibleActions.push({
      key: 'create-list',
      icon: <FolderPlus className='h-3.5 w-3.5' />,
      label: copy.createList,
      onClick: () => closeAndRun(onCreateList),
    })
  }

  if (!createSectionDisabled) {
    visibleActions.push({
      key: 'create-section',
      icon: <ListPlus className='h-3.5 w-3.5' />,
      label: copy.createSection,
      onClick: () => closeAndRun(onCreateSection),
    })
  }

  if (!importDisabled) {
    visibleActions.push({
      key: 'import',
      icon: <FileUp className='h-3.5 w-3.5' />,
      label: copy.import,
      onClick: () => closeAndRun(onImport),
    })
  }

  if (!exportDisabled) {
    visibleActions.push({
      key: 'export',
      icon: <Download className='h-3.5 w-3.5' />,
      label: copy.export,
      onClick: () => closeAndRun(onExport),
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
                <span className='sr-only'>{copy.listActionsAriaLabel}</span>
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{copy.listActionsTooltip}</TooltipContent>
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
