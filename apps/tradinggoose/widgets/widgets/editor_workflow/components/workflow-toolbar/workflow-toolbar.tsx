'use client'

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { ChevronDown, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  getBlocksForSidebar,
  getTriggersForSidebar,
  hasTriggerCapability,
} from '@/lib/workflows/trigger-utils'
import {
  getProviderIdsForBlocks,
  isBlockAvailable,
  type ProviderAvailability,
} from '@/lib/workflows/block-availability'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { BlockConfig } from '@/blocks/types'
import { ToolbarBlock } from '@/widgets/widgets/editor_workflow/components/toolbar/toolbar-block'
import LoopToolbarItem from '@/widgets/widgets/editor_workflow/components/toolbar/toolbar-loop-block'
import ParallelToolbarItem from '@/widgets/widgets/editor_workflow/components/toolbar/toolbar-parallel-block'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

interface WorkflowToolbarProps {
  workspaceId?: string
  channelId?: string
}

type ToolbarMode = 'blocks' | 'tools' | 'triggers'

interface ToolbarListData {
  regularBlocks: BlockConfig[]
  toolBlocks: BlockConfig[]
  triggerBlocks: BlockConfig[]
  includeSpecialBlocks: boolean
}

const DEFAULT_PROVIDER_AVAILABILITY: ProviderAvailability = {}

const FALLBACK_TEXT = 'Select a workspace to browse blocks'
const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14.0rem'


function useToolbarList(
  searchQuery: string,
  mode: ToolbarMode,
  providerAvailability: ProviderAvailability
): ToolbarListData {
  return useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const isTriggerMode = mode === 'triggers'
    const isBlocksMode = mode === 'blocks'
    const isToolsMode = mode === 'tools'
    const sourceBlocks = isTriggerMode ? getTriggersForSidebar() : getBlocksForSidebar()
    const availableBlocks = sourceBlocks.filter((block) =>
      isBlockAvailable(block, providerAvailability)
    )

    const filtered = availableBlocks.filter((block) => {
      if (!normalizedQuery) return true
      return (
        block.name.toLowerCase().includes(normalizedQuery) ||
        block.description.toLowerCase().includes(normalizedQuery)
      )
    })

    const regularBlocks = isBlocksMode
      ? filtered
        .filter((block) => block.category === 'blocks')
        .sort((a, b) => a.name.localeCompare(b.name))
      : []

    const toolBlocks = isToolsMode
      ? filtered
        .filter((block) => block.category === 'tools')
        .sort((a, b) => a.name.localeCompare(b.name))
      : []

    const triggerBlocks = isTriggerMode
      ? filtered
        .filter((block) => block.category === 'triggers' || hasTriggerCapability(block))
        .sort((a, b) => a.name.localeCompare(b.name))
      : []

    return {
      regularBlocks,
      toolBlocks,
      triggerBlocks,
      includeSpecialBlocks: isBlocksMode,
    }
  }, [searchQuery, mode, providerAvailability])
}

export function WorkflowToolbar({ workspaceId, channelId }: WorkflowToolbarProps) {
  const [providerAvailability, setProviderAvailability] = useState<ProviderAvailability>(
    DEFAULT_PROVIDER_AVAILABILITY
  )
  const providerIds = useMemo(
    () => getProviderIdsForBlocks([...getBlocksForSidebar(), ...getTriggersForSidebar()]),
    []
  )

  useEffect(() => {
    let isMounted = true

    const loadAvailability = async () => {
      try {
        const query = providerIds.length
          ? `?providers=${encodeURIComponent(providerIds.join(','))}`
          : ''
        const response = await fetch(`/api/auth/oauth/providers${query}`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const data = (await response.json()) as ProviderAvailability
        if (!isMounted) return
        setProviderAvailability(data)
      } catch {
        // Keep default availability (gated providers stay hidden) on failure.
      }
    }

    void loadAvailability()

    return () => {
      isMounted = false
    }
  }, [providerIds])

  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{FALLBACK_TEXT}</span>
  }

  return (
    <TooltipProvider>
      <WorkspacePermissionsProvider workspaceId={workspaceId}>
        <ToolbarDropdownGroup
          channelId={channelId}
          providerAvailability={providerAvailability}
        />
      </WorkspacePermissionsProvider>
    </TooltipProvider>
  )
}

function ToolbarDropdownGroup({
  channelId,
  providerAvailability,
}: {
  channelId?: string
  providerAvailability: ProviderAvailability
}) {
  const [blockSearch, setBlockSearch] = useState('')
  const [toolSearch, setToolSearch] = useState('')
  const [triggerSearch, setTriggerSearch] = useState('')
  const [isBlocksOpen, setBlocksOpen] = useState(false)
  const [isToolsOpen, setToolsOpen] = useState(false)
  const [isTriggersOpen, setTriggersOpen] = useState(false)

  const blockData = useToolbarList(blockSearch, 'blocks', providerAvailability)
  const toolData = useToolbarList(toolSearch, 'tools', providerAvailability)
  const triggerData = useToolbarList(triggerSearch, 'triggers', providerAvailability)

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
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
        label='Tools'
        searchValue={toolSearch}
        onSearchChange={setToolSearch}
        open={isToolsOpen}
        onOpenChange={setToolsOpen}
      >
        <ToolbarDropdownContent
          data={toolData}
          mode='tools'
          closePopover={() => setToolsOpen(false)}
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

  const tooltipText = `Browse ${label.toLowerCase()}`

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className={widgetHeaderControlClassName(
                'font-semibold text-muted-foreground hover:text-foreground'
              )}
              type='button'
            >
              <span className='flex items-center gap-1'>
                <span className='text-xs'>{label}</span>
                <ChevronDown className='h-3.5 w-3.5' />
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
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
          <div className='border-border/70 border-b p-2'>
            <div className='flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-muted-foreground text-sm'>
              <Search className='h-3.5 w-3.5 shrink-0' />
              <Input
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className='h-6 border-0 bg-transparent px-0 text-foreground text-xs placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                onKeyDown={handleSearchInputKeyDown}
                autoComplete='off'
                autoCorrect='off'
                spellCheck='false'
              />
            </div>
          </div>
          <div className='h-full min-h-0 flex-1 overflow-hidden'>{children}</div>
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
  mode: ToolbarMode
  closePopover: () => void
  channelId?: string
}) {
  const { regularBlocks, toolBlocks, triggerBlocks, includeSpecialBlocks } = data

  const hasResults = (() => {
    if (mode === 'blocks') return regularBlocks.length > 0 || includeSpecialBlocks
    if (mode === 'tools') return toolBlocks.length > 0
    return triggerBlocks.length > 0
  })()

  return (
    <ScrollArea
      className='h-full w-full px-2 py-2'
      style={{ height: DROPDOWN_VIEWPORT_HEIGHT, maxHeight: `calc(${DROPDOWN_MAX_HEIGHT} - 4rem)` }}
      onWheelCapture={(event) => event.stopPropagation()}
    >
      {!hasResults && (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>No {mode} found.</p>
      )}

      {mode === 'blocks' && regularBlocks.length > 0 && (
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

      {mode === 'blocks' && includeSpecialBlocks && (
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

      {mode === 'tools' && toolBlocks.length > 0 && (
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
