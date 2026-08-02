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
  onCreateIndicator?: () => void
  onImportIndicator?: (file: File) => Promise<void> | void
}

export function IndicatorCreateMenu({
  disabled = false,
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
    if (disabled) return
    fileInputRef.current?.click()
  }, [disabled])

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        await onImportIndicator?.(file)
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [onImportIndicator]
  )

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='inline-flex'>
                <DropdownMenuTrigger
                  render={
                    <button
                      type='button'
                      disabled={disabled}
                      className={widgetHeaderIconButtonClassName()}
                    />
                  }
                >
                  <Plus className='h-4 w-4' />
                  <span className='sr-only'>{copy.createIndicator}</span>
                </DropdownMenuTrigger>
              </span>
            }
          />
          <TooltipContent side='top'>{copy.create}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-44')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              handleCreateIndicator()
            }}
          >
            <Plus className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>{copy.newIndicator}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              handleImportSelection()
            }}
          >
            <Upload className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>{copy.importIndicator}</span>
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
