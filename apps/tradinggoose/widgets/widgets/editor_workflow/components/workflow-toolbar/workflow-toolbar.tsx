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
import { dispatchToolbarAddBlock } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-dispatcher'
import { ToolbarAddBlockProvider } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-context'
import {
  getProviderIdsForBlocks,
  isBlockAvailable,
  type ProviderAvailability,
} from '@/lib/workflows/block-availability'
import {
  getBlocksForSidebar,
  getTriggersForSidebar,
  hasTriggerCapability,
} from '@/lib/workflows/trigger-utils'
import { WorkspacePermissionsProvider } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { BlockConfig } from '@/blocks/types'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { ToolbarBlock } from '@/widgets/widgets/editor_workflow/components/toolbar/toolbar-block'
import LoopToolbarItem from '@/widgets/widgets/editor_workflow/components/toolbar/toolbar-loop-block'
import ParallelToolbarItem from '@/widgets/widgets/editor_workflow/components/toolbar/toolbar-parallel-block'

interface WorkflowToolbarProps {
  workspaceId?: string
  toolbarScopeId?: string
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

export function WorkflowToolbar({ workspaceId, toolbarScopeId }: WorkflowToolbarProps) {
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
        <ToolbarAddBlockProvider
          onAddBlock={(request) => {
            dispatchToolbarAddBlock(request, toolbarScopeId)
          }}
        >
          <ToolbarDropdownGroup providerAvailability={providerAvailability} />
        </ToolbarAddBlockProvider>
      </WorkspacePermissionsProvider>
    </TooltipProvider>
  )
}

function ToolbarDropdownGroup({
  providerAvailability,
}: {
  providerAvailability: ProviderAvailability
}) {
  const [blockSearch, setBlockSearch] = useState('')
  const [toolSearch, setToolSearch] = useState('')
  const [triggerSearch, setTriggerSearch] = useState('')

  const blockData = useToolbarList(blockSearch, 'blocks', providerAvailability)
  const toolData = useToolbarList(toolSearch, 'tools', providerAvailability)
  const triggerData = useToolbarList(triggerSearch, 'triggers', providerAvailability)

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <ToolbarDropdown label='Blocks' searchValue={blockSearch} onSearchChange={setBlockSearch}>
        <ToolbarDropdownContent data={blockData} mode='blocks' />
      </ToolbarDropdown>
      <ToolbarDropdown label='Tools' searchValue={toolSearch} onSearchChange={setToolSearch}>
        <ToolbarDropdownContent data={toolData} mode='tools' />
      </ToolbarDropdown>
      <ToolbarDropdown
        label='Triggers'
        searchValue={triggerSearch}
        onSearchChange={setTriggerSearch}
      >
        <ToolbarDropdownContent data={triggerData} mode='triggers' />
      </ToolbarDropdown>
    </div>
  )
}

interface ToolbarDropdownProps {
  label: string
  searchValue: string
  onSearchChange: (value: string) => void
  children: ReactNode
}

function ToolbarDropdown({ label, searchValue, onSearchChange, children }: ToolbarDropdownProps) {
  const handleSearchInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return

    if (event.nativeEvent.isComposing || event.key.length === 1) {
      event.stopPropagation()
    }
  }, [])

  const tooltipText = `Browse ${label.toLowerCase()}`

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                className={widgetHeaderControlClassName(
                  'group font-semibold text-muted-foreground hover:text-foreground'
                )}
                type='button'
              >
                <span className='flex items-center gap-1'>
                  <span className='text-xs'>{label}</span>
                  <ChevronDown className='h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180' />
                </span>
              </button>
            </DropdownMenuTrigger>
          </span>
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
}: {
  data: ToolbarListData
  mode: ToolbarMode
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
            <DropdownMenuItem key={block.type} className='p-0 focus:bg-transparent'>
              <ToolbarBlock config={block} />
            </DropdownMenuItem>
          ))}
        </div>
      )}

      {mode === 'blocks' && includeSpecialBlocks && (
        <div className='space-y-1 pb-2'>
          <SectionLabel title='Special' />
          <DropdownMenuItem className='p-0 focus:bg-transparent'>
            <LoopToolbarItem />
          </DropdownMenuItem>
          <DropdownMenuItem className='p-0 focus:bg-transparent'>
            <ParallelToolbarItem />
          </DropdownMenuItem>
        </div>
      )}

      {mode === 'tools' && toolBlocks.length > 0 && (
        <div className='space-y-1 pb-2'>
          <SectionLabel title='Tools' />
          {toolBlocks.map((block) => (
            <DropdownMenuItem key={block.type} className='p-0 focus:bg-transparent'>
              <ToolbarBlock config={block} />
            </DropdownMenuItem>
          ))}
        </div>
      )}

      {mode === 'triggers' && triggerBlocks.length > 0 && (
        <div className='space-y-1 pb-2'>
          <SectionLabel title='Triggers' />
          {triggerBlocks.map((block) => (
            <DropdownMenuItem key={block.type} className='p-0 focus:bg-transparent'>
              <ToolbarBlock
                config={block}
                enableTriggerMode={hasTriggerCapability(block)}
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
