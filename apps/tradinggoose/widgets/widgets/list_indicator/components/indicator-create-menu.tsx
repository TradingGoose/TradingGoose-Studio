'use client'

import { type ChangeEvent, useCallback, useRef } from 'react'
import { Plus, Upload } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
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

interface IndicatorCreateMenuProps {
  disabled?: boolean
  canCreate?: boolean
  canImport?: boolean
  isImporting?: boolean
  onCreateIndicator?: () => void
  onImportIndicator?: (content: string, filename?: string) => Promise<void> | void
}

export function IndicatorCreateMenu({
  disabled = false,
  canCreate = false,
  canImport = false,
  isImporting = false,
  onCreateIndicator,
  onImportIndicator,
}: IndicatorCreateMenuProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorList.createMenu
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCreateIndicator = useCallback(() => {
    onCreateIndicator?.()
  }, [onCreateIndicator])

  const handleImportSelection = useCallback(() => {
    if (!canImport || isImporting) return
    fileInputRef.current?.click()
  }, [canImport, isImporting])

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const content = await file.text()
        await onImportIndicator?.(content, file.name)
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [onImportIndicator]
  )

  const isMenuDisabled = disabled

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  disabled={isMenuDisabled}
                  className={widgetHeaderIconButtonClassName()}
                >
                  <Plus className='h-4 w-4' />
                  <span className='sr-only'>{copy.createIndicator}</span>
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>{copy.create}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-44')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={!canCreate}
            onSelect={() => {
              if (!canCreate) return
              handleCreateIndicator()
            }}
          >
            <Plus className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>{copy.newIndicator}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={!canImport || isImporting}
            onSelect={() => {
              if (!canImport || isImporting) return
              handleImportSelection()
            }}
          >
            <Upload className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {isImporting ? copy.importingIndicator : copy.importIndicator}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={handleFileChange}
      />
    </>
  )
}
