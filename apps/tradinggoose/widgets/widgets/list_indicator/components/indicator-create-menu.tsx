'use client'

import { type ChangeEvent, useCallback, useRef } from 'react'
import { Plus, Upload } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

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
                  <span className='sr-only'>Create indicator</span>
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>Create</TooltipContent>
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
            <span className={widgetHeaderMenuTextClassName}>New indicator</span>
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
              {isImporting ? 'Importing indicator' : 'Import indicator'}
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
