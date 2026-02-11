'use client'

import { Check, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { BlockInfo, TerminalFilters } from '../types'
import { getBlockIcon } from '../utils'

interface FilterPopoverProps {
  filters: TerminalFilters
  toggleStatus: (status: 'error' | 'info') => void
  toggleBlock: (blockId: string) => void
  uniqueBlocks: BlockInfo[]
  hasActiveFilters: boolean
  triggerClassName?: string
  disabled?: boolean
}

export function FilterPopover({
  filters,
  toggleStatus,
  toggleBlock,
  uniqueBlocks,
  hasActiveFilters,
  triggerClassName,
  disabled = false,
}: FilterPopoverProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className='w-64 max-h-[18rem] overflow-hidden p-0'
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className='flex max-h-[inherit] flex-col'>
          <div className='px-1 pt-1'>
            <DropdownMenuLabel className='px-2 py-1 text-xs text-muted-foreground'>
              Status
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                toggleStatus('error')
              }}
              className='gap-2'
            >
              <div className='h-2 w-2 rounded-sm bg-destructive' />
              <span className='flex-1 text-left'>Error</span>
              {filters.statuses.has('error') && <Check className='h-3 w-3 text-muted-foreground' />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                toggleStatus('info')
              }}
              className='gap-2'
            >
              <div className='h-2 w-2 rounded-sm bg-emerald-500' />
              <span className='flex-1 text-left'>Info</span>
              {filters.statuses.has('info') && <Check className='h-3 w-3 text-muted-foreground' />}
            </DropdownMenuItem>
          </div>

          {uniqueBlocks.length > 0 && (
            <>
              <DropdownMenuSeparator className='my-1' />
              <DropdownMenuLabel className='px-3 py-1 text-xs text-muted-foreground'>
                Blocks
              </DropdownMenuLabel>
              <div className='px-1 pb-1'>
                <ScrollArea
                  className='h-40 w-full'
                  onWheelCapture={(event) => event.stopPropagation()}
                >
                  <div className='flex flex-col gap-0.5 pr-1'>
                    {uniqueBlocks.map((block) => {
                      const BlockIcon = getBlockIcon(block.blockType)
                      const isSelected = filters.blockIds.has(block.blockId)

                      return (
                        <DropdownMenuItem
                          key={block.blockId}
                          onSelect={(event) => {
                            event.preventDefault()
                            toggleBlock(block.blockId)
                          }}
                          className='gap-2'
                        >
                          {BlockIcon && <BlockIcon className='h-3 w-3 text-muted-foreground' />}
                          <span className='flex-1 truncate text-left'>{block.blockName}</span>
                          {isSelected && <Check className='h-3 w-3 text-muted-foreground' />}
                        </DropdownMenuItem>
                      )
                    })}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
