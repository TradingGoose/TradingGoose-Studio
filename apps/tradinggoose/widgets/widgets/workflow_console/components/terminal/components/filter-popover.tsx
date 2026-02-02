'use client'

import { Filter, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { BlockInfo, TerminalFilters } from '../types'
import { getBlockIcon } from '../utils'

interface FilterPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: TerminalFilters
  toggleStatus: (status: 'error' | 'info') => void
  toggleBlock: (blockId: string) => void
  uniqueBlocks: BlockInfo[]
  hasActiveFilters: boolean
  triggerClassName?: string
  disabled?: boolean
}

export function FilterPopover({
  open,
  onOpenChange,
  filters,
  toggleStatus,
  toggleBlock,
  uniqueBlocks,
  hasActiveFilters,
  triggerClassName,
  disabled = false,
}: FilterPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className={cn('h-6 w-6', triggerClassName)}
          onClick={(event) => event.stopPropagation()}
          aria-label='Filters'
          disabled={disabled}
        >
          <Filter className={cn('h-4 w-4', hasActiveFilters && 'text-primary')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side='bottom'
        align='end'
        className='w-64 p-2'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='px-2 py-1 text-xs text-muted-foreground'>Status</div>
        <button
          type='button'
          className='flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted'
          onClick={() => toggleStatus('error')}
        >
          <div className='h-2 w-2 rounded-sm bg-destructive' />
          <span className='flex-1 text-left'>Error</span>
          {filters.statuses.has('error') && <Check className='h-3 w-3 text-muted-foreground' />}
        </button>
        <button
          type='button'
          className='flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted'
          onClick={() => toggleStatus('info')}
        >
          <div className='h-2 w-2 rounded-sm bg-emerald-500' />
          <span className='flex-1 text-left'>Info</span>
          {filters.statuses.has('info') && <Check className='h-3 w-3 text-muted-foreground' />}
        </button>

        {uniqueBlocks.length > 0 && (
          <>
            <Separator className='my-2' />
            <div className='px-2 py-1 text-xs text-muted-foreground'>Blocks</div>
            <ScrollArea className='max-h-40'>
              <div className='flex flex-col gap-0.5'>
                {uniqueBlocks.map((block) => {
                  const BlockIcon = getBlockIcon(block.blockType)
                  const isSelected = filters.blockIds.has(block.blockId)

                  return (
                    <button
                      key={block.blockId}
                      type='button'
                      className='flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted'
                      onClick={() => toggleBlock(block.blockId)}
                    >
                      {BlockIcon && <BlockIcon className='h-3 w-3 text-muted-foreground' />}
                      <span className='flex-1 truncate text-left'>{block.blockName}</span>
                      {isSelected && <Check className='h-3 w-3 text-muted-foreground' />}
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
