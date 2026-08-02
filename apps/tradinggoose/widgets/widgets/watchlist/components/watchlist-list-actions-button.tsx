'use client'

import { Download, FileUp, FolderPlus, ListPlus, Plus } from 'lucide-react'
import { useMessages } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'

type WatchlistListActionsButtonProps = {
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

export const WatchlistListActionsButton = ({
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
  const copy = useMessages().workspace.widgets.watchlist.header

  const actions = [
    {
      key: 'create-list',
      icon: FolderPlus,
      label: copy.createList,
      disabled: createListDisabled,
      handler: onCreateList,
    },
    {
      key: 'create-section',
      icon: ListPlus,
      label: copy.createSection,
      disabled: createSectionDisabled,
      handler: onCreateSection,
    },
    {
      key: 'import',
      icon: FileUp,
      label: copy.import,
      disabled: importDisabled,
      handler: onImport,
    },
    {
      key: 'export',
      icon: Download,
      label: copy.export,
      disabled: exportDisabled,
      handler: onExport,
    },
  ]

  const allDisabled = disabled || actions.every((action) => action.disabled)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className='inline-flex'>
              <DropdownMenuTrigger
                render={
                  <button
                    type='button'
                    className={widgetHeaderIconButtonClassName()}
                    disabled={allDisabled}
                  />
                }
              >
                <Plus className='h-3.5 w-3.5' />
                <span className='sr-only'>{copy.listActionsAriaLabel}</span>
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent side='top'>{copy.listActionsTooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='end'
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-56 p-1')}
      >
        {actions.map(({ key, icon: Icon, label, disabled: actionDisabled, handler }) => (
          <DropdownMenuItem
            key={key}
            className={widgetHeaderMenuItemClassName}
            disabled={actionDisabled}
            onClick={() => {
              if (actionDisabled) return
              handler()
            }}
          >
            <Icon className={widgetHeaderMenuIconClassName} aria-hidden='true' />
            <span className={widgetHeaderMenuTextClassName}>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
