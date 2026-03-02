'use client'

import type { KeyboardEvent } from 'react'
import { Check, ListPlus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'

type WatchlistAddSectionButtonProps = {
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  sectionName: string
  onSectionNameChange: (nextValue: string) => void
  onSubmit: () => Promise<void> | void
  disabled?: boolean
  isMutating?: boolean
}

export const WatchlistAddSectionButton = ({
  open,
  onOpenChange,
  sectionName,
  onSectionNameChange,
  onSubmit,
  disabled = false,
  isMutating = false,
}: WatchlistAddSectionButtonProps) => {
  const handleSubmit = () => {
    void onSubmit()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    handleSubmit()
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                disabled={disabled}
              >
                <ListPlus className='h-3.5 w-3.5' />
                <span className='sr-only'>Add section</span>
              </button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>Add section</TooltipContent>
      </Tooltip>
      <PopoverContent className='w-64 p-2' align='end'>
        <div className='flex items-center gap-2'>
          <Input
            placeholder='Section name'
            value={sectionName}
            onChange={(event) => onSectionNameChange(event.target.value)}
            disabled={isMutating}
            onKeyDown={handleInputKeyDown}
            className='h-7 rounded-sm px-2 text-xs'
          />
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={handleSubmit}
            disabled={isMutating || !sectionName.trim()}
          >
            <Check className='h-3.5 w-3.5' />
            <span className='sr-only'>Add section</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
