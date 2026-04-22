'use client'

import type { MouseEvent, ReactNode, RefObject } from 'react'
import {
  Activity,
  Blocks,
  BookOpen,
  Bot,
  Box,
  Check,
  ChevronRight,
  LibraryBig,
  Server,
  SquareChevronRight,
  ToolCase,
  Workflow,
  Wrench,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { getIconTileStyle, sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import {
  type CopilotWorkspaceEntityKind,
  getCopilotWorkspaceEntityKindFromMentionOption,
  isCopilotWorkspaceEntityMentionOption,
} from '../../../workspace-entities'
import {
  buildAggregatedMentionItems,
  filterBlocks,
  filterKnowledgeBases,
  filterLogs,
  filterMentionOptions,
  filterPastChats,
  filterWorkflowBlocks,
  filterWorkspaceEntitiesForOption,
  getMentionSubmenuTitle,
} from '../mention-utils'
import type {
  AggregatedMentionItem,
  BlockItem,
  KnowledgeBaseItem,
  LogItem,
  MentionItem,
  MentionOption,
  MentionPortalStyle,
  MentionSources,
  MentionSubmenu,
  PastChatItem,
  WorkflowBlockItem,
  WorkspaceEntityItem,
} from '../types'
import { getWorkspaceEntityMentionEmptyState } from '../workspace-entity-mentions'

interface MentionMenuProps {
  inAggregated: boolean
  loading: Record<MentionSubmenu, boolean>
  mentionActiveIndex: number
  mentionMenuRef: RefObject<HTMLDivElement | null>
  mentionPortalRef: RefObject<HTMLDivElement | null>
  mentionPortalStyle: MentionPortalStyle | null
  mentionQuery: string
  menuListRef: RefObject<HTMLDivElement | null>
  onAggregatedItemHover: (index: number) => void
  onMainOptionHover: (index: number) => void
  onSelectAggregatedItem: (item: AggregatedMentionItem) => void
  onSelectMainOption: (option: MentionOption) => void
  onSelectSubmenuItem: (submenu: MentionSubmenu, item: MentionItem) => void
  onSubmenuItemHover: (index: number) => void
  openSubmenuFor: MentionSubmenu | null
  showMentionMenu: boolean
  sources: MentionSources
  submenuActiveIndex: number
  submenuQuery: string
}

const FALLBACK_WORKFLOW_COLOR = '#3972F6'
const FALLBACK_INDICATOR_COLOR = '#3972F6'
const SKILL_ICON_COLOR = '#059669'
const CUSTOM_TOOL_ICON_COLOR = '#d97706'
const DEFAULT_MCP_ICON_COLOR = '#64748b'

const formatTimestamp = (iso: string) => {
  try {
    const date = new Date(iso)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  } catch {
    return iso
  }
}

const getServerIconColor = (status?: WorkspaceEntityItem['connectionStatus']) => {
  if (status === 'connected') {
    return '#10b981'
  }

  if (status === 'error') {
    return '#ef4444'
  }

  return DEFAULT_MCP_ICON_COLOR
}

const renderBlockIcon = (item: BlockItem | WorkflowBlockItem) => {
  const Icon = item.iconComponent

  return (
    <div
      className='relative flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary text-foreground'
      style={getIconTileStyle(item.bgColor)}
    >
      {Icon ? <Icon className='!h-3 !w-3' /> : null}
    </div>
  )
}

const renderWorkflowBadge = (color?: string) => {
  const iconColor = sanitizeSolidIconColor(color) || FALLBACK_WORKFLOW_COLOR

  return (
    <span
      className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
      style={{ backgroundColor: `${iconColor}20` }}
      aria-hidden='true'
    >
      <Workflow className='h-4 w-4' aria-hidden='true' style={{ color: iconColor }} />
    </span>
  )
}

const renderIndicatorBadge = (color?: string) => {
  const iconColor = sanitizeSolidIconColor(color) || FALLBACK_INDICATOR_COLOR

  return (
    <span
      className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
      style={{ backgroundColor: `${iconColor}20` }}
      aria-hidden='true'
    >
      <Activity className='h-4 w-4' aria-hidden='true' style={{ color: iconColor }} />
    </span>
  )
}

const renderCustomToolBadge = () => (
  <span
    className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
    style={{ backgroundColor: `${CUSTOM_TOOL_ICON_COLOR}20` }}
    aria-hidden='true'
  >
    <Wrench className='h-4 w-4' aria-hidden='true' style={{ color: CUSTOM_TOOL_ICON_COLOR }} />
  </span>
)

const renderSkillBadge = () => (
  <span
    className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
    style={{ backgroundColor: `${SKILL_ICON_COLOR}20` }}
    aria-hidden='true'
  >
    <ToolCase className='h-4 w-4' aria-hidden='true' style={{ color: SKILL_ICON_COLOR }} />
  </span>
)

const renderMcpServerBadge = (status?: WorkspaceEntityItem['connectionStatus']) => {
  const iconColor = getServerIconColor(status)

  return (
    <span
      className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
      style={{ backgroundColor: `${iconColor}20` }}
      aria-hidden='true'
    >
      <Server className='h-4 w-4' aria-hidden='true' style={{ color: iconColor }} />
    </span>
  )
}

const WORKSPACE_ENTITY_MAIN_OPTION_ICONS: Record<
  CopilotWorkspaceEntityKind,
  typeof Workflow | typeof ToolCase | typeof Activity | typeof Wrench | typeof Server
> = {
  workflow: Workflow,
  skill: ToolCase,
  indicator: Activity,
  custom_tool: Wrench,
  mcp_server: Server,
}

const renderWorkspaceEntityMainOptionIcon = (entityKind: CopilotWorkspaceEntityKind) => {
  const Icon = WORKSPACE_ENTITY_MAIN_OPTION_ICONS[entityKind]
  return <Icon className='h-3.5 w-3.5 text-muted-foreground' />
}

const WORKSPACE_ENTITY_ITEM_RENDERERS: Record<
  CopilotWorkspaceEntityKind,
  (entity: WorkspaceEntityItem) => ReactNode
> = {
  workflow: (entity) => (
    <>
      {renderWorkflowBadge(entity.color)}
      <span className='truncate'>{entity.name}</span>
    </>
  ),
  skill: (entity) => (
    <>
      {renderSkillBadge()}
      <span className='truncate'>{entity.name}</span>
    </>
  ),
  indicator: (entity) => (
    <>
      {renderIndicatorBadge(entity.color)}
      <span className='truncate'>{entity.name}</span>
    </>
  ),
  custom_tool: (entity) => (
    <>
      {renderCustomToolBadge()}
      <span className='truncate'>{entity.name}</span>
      {entity.functionName ? (
        <>
          <span className='text-muted-foreground'>·</span>
          <span className='truncate text-muted-foreground text-xs'>{entity.functionName}</span>
        </>
      ) : null}
    </>
  ),
  mcp_server: (entity) => (
    <>
      {renderMcpServerBadge(entity.connectionStatus)}
      <span className='truncate'>{entity.name}</span>
      {entity.transport ? (
        <>
          <span className='text-muted-foreground'>·</span>
          <span className='text-muted-foreground text-xs uppercase'>{entity.transport}</span>
        </>
      ) : null}
    </>
  ),
}

const renderMainOptionIcon = (option: MentionOption) => {
  if (option === 'Chats') {
    return <Bot className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (isCopilotWorkspaceEntityMentionOption(option)) {
    return renderWorkspaceEntityMainOptionIcon(
      getCopilotWorkspaceEntityKindFromMentionOption(option)
    )
  }

  if (option === 'Blocks') {
    return <Blocks className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'Workflow Blocks') {
    return <Box className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'Knowledge') {
    return <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'Docs') {
    return <BookOpen className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'Logs') {
    return <SquareChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
  }

  return <div className='h-3.5 w-3.5' />
}

const renderMentionItemContent = (type: MentionSubmenu, item: MentionItem) => {
  if (type === 'Chats') {
    const chat = item as PastChatItem
    return (
      <>
        <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
          <Bot className='h-3.5 w-3.5 text-muted-foreground' strokeWidth={1.5} />
        </div>
        <span className='truncate'>{chat.title || 'Untitled Chat'}</span>
      </>
    )
  }

  if (isCopilotWorkspaceEntityMentionOption(type)) {
    const entity = item as WorkspaceEntityItem
    return WORKSPACE_ENTITY_ITEM_RENDERERS[entity.entityKind](entity)
  }

  if (type === 'Knowledge') {
    const knowledgeBase = item as KnowledgeBaseItem
    return (
      <>
        <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
        <span className='truncate'>{knowledgeBase.name || 'Untitled'}</span>
      </>
    )
  }

  if (type === 'Blocks') {
    const block = item as BlockItem
    return (
      <>
        {renderBlockIcon(block)}
        <span className='truncate'>{block.name || block.id}</span>
      </>
    )
  }

  if (type === 'Workflow Blocks') {
    const block = item as WorkflowBlockItem
    return (
      <>
        {renderBlockIcon(block)}
        <span className='truncate'>{block.name || block.id}</span>
      </>
    )
  }

  if (type === 'Logs') {
    const log = item as LogItem
    return (
      <>
        {log.level === 'error' ? (
          <X className='h-3.5 w-3.5 text-red-500' />
        ) : (
          <Check className='h-3.5 w-3.5 text-green-500' />
        )}
        <span className='min-w-0 truncate'>{log.workflowName}</span>
        <span className='text-muted-foreground'>·</span>
        <span className='whitespace-nowrap'>{formatTimestamp(log.createdAt)}</span>
        <span className='text-muted-foreground'>·</span>
        <span className='capitalize'>{(log.trigger || 'manual').toLowerCase()}</span>
      </>
    )
  }

  return null
}

const getSubmenuItems = (
  submenu: MentionSubmenu,
  query: string,
  sources: MentionSources
): MentionItem[] => {
  if (submenu === 'Chats') {
    return filterPastChats(sources.pastChats, query)
  }

  if (isCopilotWorkspaceEntityMentionOption(submenu)) {
    return filterWorkspaceEntitiesForOption(submenu, sources, query)
  }

  if (submenu === 'Knowledge') {
    return filterKnowledgeBases(sources.knowledgeBases, query)
  }

  if (submenu === 'Blocks') {
    return filterBlocks(sources.blocksList, query)
  }

  if (submenu === 'Workflow Blocks') {
    return filterWorkflowBlocks(sources.workflowBlocks, query)
  }

  return filterLogs(sources.logsList, query)
}

const getSubmenuEmptyState = (submenu: MentionSubmenu) => {
  if (submenu === 'Chats') {
    return 'No past chats'
  }

  if (isCopilotWorkspaceEntityMentionOption(submenu)) {
    return getWorkspaceEntityMentionEmptyState(
      getCopilotWorkspaceEntityKindFromMentionOption(submenu)
    )
  }

  if (submenu === 'Knowledge') {
    return 'No knowledge bases'
  }

  if (submenu === 'Blocks') {
    return 'No blocks found'
  }

  if (submenu === 'Workflow Blocks') {
    return 'No blocks in this workflow'
  }

  return 'No executions found'
}

const isSubmenuLoading = (submenu: MentionSubmenu, loading: MentionMenuProps['loading']) => {
  return loading[submenu]
}

const preserveEditorSelection = (event: MouseEvent<HTMLDivElement>) => {
  event.preventDefault()
}

export function MentionMenu({
  inAggregated,
  loading,
  mentionActiveIndex,
  mentionMenuRef,
  mentionPortalRef,
  mentionPortalStyle,
  mentionQuery,
  menuListRef,
  onAggregatedItemHover,
  onMainOptionHover,
  onSelectAggregatedItem,
  onSelectMainOption,
  onSelectSubmenuItem,
  onSubmenuItemHover,
  openSubmenuFor,
  showMentionMenu,
  sources,
  submenuActiveIndex,
  submenuQuery,
}: MentionMenuProps) {
  if (!showMentionMenu || !mentionPortalStyle) {
    return null
  }

  const filteredOptions = filterMentionOptions(mentionQuery)
  const aggregatedItems = buildAggregatedMentionItems(mentionQuery, sources)
  const showAggregatedSearch = mentionQuery.length > 0 && filteredOptions.length === 0
  const submenuItems = openSubmenuFor ? getSubmenuItems(openSubmenuFor, submenuQuery, sources) : []

  return createPortal(
    <div
      ref={mentionPortalRef}
      style={{
        position: 'fixed',
        top: mentionPortalStyle.top,
        left: mentionPortalStyle.left,
        width: mentionPortalStyle.width,
        maxHeight: mentionPortalStyle.maxHeight,
        zIndex: 9999999,
        pointerEvents: 'auto',
        isolation: 'isolate',
        transform: mentionPortalStyle.showBelow ? 'none' : 'translateY(-100%)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={mentionMenuRef}
        className='flex flex-col overflow-hidden rounded-sm border bg-popover p-1 text-foreground shadow-md'
        style={{
          maxHeight: mentionPortalStyle.maxHeight,
          height: '100%',
          position: 'relative',
          zIndex: 9999999,
        }}
      >
        {openSubmenuFor ? (
          <>
            <div className='px-2 py-1.5 text-muted-foreground text-xs'>
              {getMentionSubmenuTitle(openSubmenuFor)}
            </div>
            <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
              {isSubmenuLoading(openSubmenuFor, loading) ? (
                <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
              ) : submenuItems.length === 0 ? (
                <div className='px-2 py-2 text-muted-foreground text-sm'>
                  {getSubmenuEmptyState(openSubmenuFor)}
                </div>
              ) : (
                submenuItems.map((item, index) => (
                  <div
                    key={`${openSubmenuFor}-${(item as any).id || (item as any).reviewSessionId || index}`}
                    data-idx={index}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-card/60',
                      submenuActiveIndex === index && 'bg-muted'
                    )}
                    role='menuitem'
                    aria-selected={submenuActiveIndex === index}
                    onMouseDown={preserveEditorSelection}
                    onMouseEnter={() => onSubmenuItemHover(index)}
                    onClick={() => onSelectSubmenuItem(openSubmenuFor, item)}
                  >
                    {renderMentionItemContent(openSubmenuFor, item)}
                  </div>
                ))
              )}
            </div>
          </>
        ) : showAggregatedSearch ? (
          <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
            {aggregatedItems.length === 0 ? (
              <div className='px-2 py-2 text-muted-foreground text-sm'>No matches</div>
            ) : (
              aggregatedItems.map((item, index) => (
                <div
                  key={`${item.type}-${item.id}`}
                  data-idx={index}
                  className={cn(
                    'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-card/60',
                    submenuActiveIndex === index && 'bg-muted'
                  )}
                  role='menuitem'
                  aria-selected={submenuActiveIndex === index}
                  onMouseDown={preserveEditorSelection}
                  onMouseEnter={() => onAggregatedItemHover(index)}
                  onClick={() => onSelectAggregatedItem(item)}
                >
                  {renderMentionItemContent(item.type, item.value)}
                </div>
              ))
            )}
          </div>
        ) : (
          <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
            {filteredOptions.map((option, index) => (
              <div
                key={option}
                data-idx={index}
                className={cn(
                  'flex cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-card/60',
                  !inAggregated && mentionActiveIndex === index && 'bg-muted'
                )}
                role='menuitem'
                aria-selected={!inAggregated && mentionActiveIndex === index}
                onMouseDown={preserveEditorSelection}
                onMouseEnter={() => onMainOptionHover(index)}
                onClick={() => onSelectMainOption(option)}
              >
                <div className='flex items-center gap-1'>
                  {renderMainOptionIcon(option)}
                  <span>
                    {isCopilotWorkspaceEntityMentionOption(option)
                      ? getMentionSubmenuTitle(option)
                      : option}
                  </span>
                </div>
                {option !== 'Docs' && (
                  <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                )}
              </div>
            ))}

            {mentionQuery.length > 0 && aggregatedItems.length > 0 && (
              <>
                <div className='my-1 h-px bg-border/70' />
                <div className='px-2 py-1 text-[11px] text-muted-foreground'>Matches</div>
                {aggregatedItems.map((item, index) => (
                  <div
                    key={`${item.type}-${item.id}`}
                    data-idx={filteredOptions.length + index}
                    className={cn(
                      'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-card/60',
                      inAggregated && submenuActiveIndex === index && 'bg-muted'
                    )}
                    role='menuitem'
                    aria-selected={inAggregated && submenuActiveIndex === index}
                    onMouseDown={preserveEditorSelection}
                    onMouseEnter={() => onAggregatedItemHover(index)}
                    onClick={() => onSelectAggregatedItem(item)}
                  >
                    {renderMentionItemContent(item.type, item.value)}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
