'use client'

import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/components/widget-header-control'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  getBlocksForSidebar,
  getTriggersForSidebar,
  hasTriggerCapability,
} from '@/lib/workflows/trigger-utils'
import { ToolbarBlock } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/toolbar/components/toolbar-block/toolbar-block'
import LoopToolbarItem from '@/app/workspace/[workspaceId]/w/components/sidebar/components/toolbar/components/toolbar-loop-block/toolbar-loop-block'
import ParallelToolbarItem from '@/app/workspace/[workspaceId]/w/components/sidebar/components/toolbar/components/toolbar-parallel-block/toolbar-parallel-block'
import type { BlockConfig } from '@/blocks/types'

interface WorkflowToolbarProps {
  workspaceId?: string
  channelId?: string
}

interface ToolbarListData {
  regularBlocks: BlockConfig[]
  toolBlocks: BlockConfig[]
  triggerBlocks: BlockConfig[]
  includeSpecialBlocks: boolean
}

const FALLBACK_TEXT = 'Select a workspace to browse blocks'
const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14.0rem'

function useToolbarList(searchQuery: string, mode: 'blocks' | 'triggers'): ToolbarListData {
  return useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const sourceBlocks = mode === 'blocks' ? getBlocksForSidebar() : getTriggersForSidebar()

    const filtered = sourceBlocks.filter((block) => {
      if (!normalizedQuery) return true
      return (
        block.name.toLowerCase().includes(normalizedQuery) ||
        block.description.toLowerCase().includes(normalizedQuery)
      )
    })

    const regularBlocks = filtered
      .filter((block) => block.category === 'blocks')
      .sort((a, b) => a.name.localeCompare(b.name))

    const toolBlocks = filtered
      .filter((block) => block.category === 'tools')
      .sort((a, b) => a.name.localeCompare(b.name))

    const triggerBlocks = filtered
      .filter((block) => block.category === 'triggers' || mode === 'triggers')
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      regularBlocks,
      toolBlocks,
      triggerBlocks,
      includeSpecialBlocks: mode === 'blocks',
    }
  }, [searchQuery, mode])
}

export function WorkflowToolbar({ workspaceId, channelId }: WorkflowToolbarProps) {
  if (!workspaceId) {
    return <span className='text-xs text-muted-foreground'>{FALLBACK_TEXT}</span>
  }

  return (
    <TooltipProvider>
      <WorkspacePermissionsProvider workspaceId={workspaceId}>
        <ToolbarDropdownGroup channelId={channelId} />
      </WorkspacePermissionsProvider>
    </TooltipProvider>
  )
}

function ToolbarDropdownGroup({ channelId }: { channelId?: string }) {
  const [blockSearch, setBlockSearch] = useState('')
  const [triggerSearch, setTriggerSearch] = useState('')
  const [isBlocksOpen, setBlocksOpen] = useState(false)
  const [isTriggersOpen, setTriggersOpen] = useState(false)

  const blockData = useToolbarList(blockSearch, 'blocks')
  const triggerData = useToolbarList(triggerSearch, 'triggers')

  return (
    <div className='flex items-center gap-2'>
      <ToolbarDropdown
        label='Blocks'
        searchValue={blockSearch}
        onSearchChange={setBlockSearch}
        open={isBlocksOpen}
        onOpenChange={setBlocksOpen}
      >
        <ToolbarDropdownContent
          data={blockData}
          mode='blocks'
          closePopover={() => setBlocksOpen(false)}
          channelId={channelId}
        />
      </ToolbarDropdown>
      <ToolbarDropdown
        label='Triggers'
        searchValue={triggerSearch}
        onSearchChange={setTriggerSearch}
        open={isTriggersOpen}
        onOpenChange={setTriggersOpen}
      >
        <ToolbarDropdownContent
          data={triggerData}
          mode='triggers'
          closePopover={() => setTriggersOpen(false)}
          channelId={channelId}
        />
      </ToolbarDropdown>
    </div>
  )
}

interface ToolbarDropdownProps {
  label: string
  searchValue: string
  onSearchChange: (value: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

function ToolbarDropdown({
  label,
  searchValue,
  onSearchChange,
  open,
  onOpenChange,
  children,
}: ToolbarDropdownProps) {
  const handleSearchInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return

    if (event.nativeEvent.isComposing || event.key.length === 1) {
      event.stopPropagation()
    }
  }, [])

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className={widgetHeaderControlClassName(
            'font-semibold text-muted-foreground hover:text-foreground'
          )}
          type='button'
        >
          <span className='flex items-center gap-2'>
            <span className='text-xs'>{label}</span>
            <ChevronDown className='h-3.5 w-3.5' />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        sideOffset={6}
        className={cn(
          widgetHeaderMenuContentClassName,
          ' max-h-[20rem] overflow-hidden p-0 shadow-lg'
        )}
        style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className='flex h-full max-h-[inherit] flex-col'>
          <div className='border-b border-border/70 p-2'>
            <div className='flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm text-muted-foreground'>
              <Search className='h-3.5 w-3.5 shrink-0' />
              <Input
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className='h-6 border-0 bg-transparent px-0 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                onKeyDown={handleSearchInputKeyDown}
                autoComplete='off'
                autoCorrect='off'
                spellCheck='false'
              />
            </div>
          </div>
          <div className='min-h-0 flex-1 overflow-hidden h-full'>{children}</div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ToolbarDropdownContent({
  data,
  mode,
  closePopover,
  channelId,
}: {
  data: ToolbarListData
  mode: 'blocks' | 'triggers'
  closePopover: () => void
  channelId?: string
}) {
  const { regularBlocks, toolBlocks, triggerBlocks, includeSpecialBlocks } = data

  const hasResults =
    regularBlocks.length > 0 ||
    toolBlocks.length > 0 ||
    triggerBlocks.length > 0 ||
    includeSpecialBlocks

  return (
    <ScrollArea
      className='h-full w-full px-2 py-2'
      style={{ height: DROPDOWN_VIEWPORT_HEIGHT, maxHeight: `calc(${DROPDOWN_MAX_HEIGHT} - 4rem)` }}
      onWheelCapture={(event) => event.stopPropagation()}
    >
      {!hasResults && (
        <p className='px-2 py-4 text-center text-xs text-muted-foreground'>No {mode} found.</p>
      )}

      {regularBlocks.length > 0 && (
        <div className='space-y-1 pb-2'>
          <SectionLabel title='Blocks' />
          {regularBlocks.map((block) => (
            <DropdownMenuItem
              key={block.type}
              className='p-0 focus:bg-transparent'
              onSelect={(event) => {
                event.preventDefault()
                closePopover()
              }}
            >
              <ToolbarBlock config={block} channelId={channelId} />
            </DropdownMenuItem>
          ))}
        </div>
      )}

      {includeSpecialBlocks && (
        <div className='space-y-1 pb-2'>
          <SectionLabel title='Special' />
          <DropdownMenuItem
            className='p-0 focus:bg-transparent'
            onSelect={(event) => {
              event.preventDefault()
              closePopover()
            }}
          >
            <LoopToolbarItem channelId={channelId} />
          </DropdownMenuItem>
          <DropdownMenuItem
            className='p-0 focus:bg-transparent'
            onSelect={(event) => {
              event.preventDefault()
              closePopover()
            }}
          >
            <ParallelToolbarItem channelId={channelId} />
          </DropdownMenuItem>
        </div>
      )}

      {toolBlocks.length > 0 && (
        <div className='space-y-1 pb-2'>
          <SectionLabel title='Tools' />
          {toolBlocks.map((block) => (
            <DropdownMenuItem
              key={block.type}
              className='p-0 focus:bg-transparent'
              onSelect={(event) => {
                event.preventDefault()
                closePopover()
              }}
            >
              <ToolbarBlock config={block} channelId={channelId} />
            </DropdownMenuItem>
          ))}
        </div>
      )}

      {mode === 'triggers' && triggerBlocks.length > 0 && (
        <div className='space-y-1 pb-2'>
          <SectionLabel title='Triggers' />
          {triggerBlocks.map((block) => (
            <DropdownMenuItem
              key={block.type}
              className='p-0 focus:bg-transparent'
              onSelect={(event) => {
                event.preventDefault()
                closePopover()
              }}
            >
              <ToolbarBlock
                config={block}
                enableTriggerMode={hasTriggerCapability(block)}
                channelId={channelId}
              />
            </DropdownMenuItem>
          ))}
        </div>
      )}
    </ScrollArea>
  )
}

const SectionLabel = ({ title }: { title: string }) => (
  <p className={cn('px-1 text-[11px] uppercase tracking-wide', widgetHeaderMenuTextClassName)}>
    {title}
  </p>
)
