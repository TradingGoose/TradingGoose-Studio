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
  ListChecks,
  type LucideIcon,
  Server,
  SquareChevronRight,
  ToolCase,
  Workflow,
  Wrench,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { getEntityIconColor, getIconTileStyle } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import {
  type CopilotWorkspaceEntityKind,
  isCopilotWorkspaceEntityMentionOption,
} from '../../../workspace-entities'
import {
  type CopilotMentionCopy,
  getKnowledgeBaseMentionLabel,
  getLogMentionTriggerLabel,
  getMentionOptionLabel,
  getMentionSubmenuTitle,
  getPastChatMentionLabel,
  getWorkspaceEntityMentionLabel,
  useCopilotMentionCopy,
} from '../mention-copy'
import {
  buildAggregatedMentionItems,
  filterMentionItems,
  filterMentionOptions,
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

const renderEntityBadge = ({
  icon: Icon,
  entityId,
  color,
}: {
  icon: LucideIcon
  entityId: string
  color?: string
}) => {
  const iconColor = getEntityIconColor(entityId, color)

  return (
    <span
      className='flex h-5 w-5 shrink-0 items-center justify-center rounded-xs p-0.5'
      style={{ backgroundColor: `${iconColor}20` }}
      aria-hidden='true'
    >
      <Icon className='h-4 w-4' aria-hidden='true' style={{ color: iconColor }} />
    </span>
  )
}

const WORKSPACE_ENTITY_MAIN_OPTION_ICONS: Record<CopilotWorkspaceEntityKind, LucideIcon> = {
  workflow: Workflow,
  skill: ToolCase,
  indicator: Activity,
  custom_tool: Wrench,
  mcp_server: Server,
  watchlist: ListChecks,
}

const renderWorkspaceEntityMainOptionIcon = (entityKind: CopilotWorkspaceEntityKind) => {
  const Icon = WORKSPACE_ENTITY_MAIN_OPTION_ICONS[entityKind]
  return <Icon className='h-3.5 w-3.5 text-muted-foreground' />
}

const WORKSPACE_ENTITY_ITEM_RENDERERS: Record<
  CopilotWorkspaceEntityKind,
  (entity: WorkspaceEntityItem, label: string) => ReactNode
> = {
  workflow: (entity, label) => (
    <>
      {renderEntityBadge({ icon: Workflow, entityId: entity.id, color: entity.color })}
      <span className='truncate'>{label}</span>
    </>
  ),
  skill: (entity, label) => (
    <>
      {renderEntityBadge({ icon: ToolCase, entityId: entity.id })}
      <span className='truncate'>{label}</span>
    </>
  ),
  indicator: (entity, label) => (
    <>
      {renderEntityBadge({ icon: Activity, entityId: entity.id, color: entity.color })}
      <span className='truncate'>{label}</span>
    </>
  ),
  custom_tool: (entity, label) => (
    <>
      {renderEntityBadge({ icon: Wrench, entityId: entity.id })}
      <span className='truncate'>{label}</span>
    </>
  ),
  mcp_server: (entity, label) => (
    <>
      {renderEntityBadge({ icon: Server, entityId: entity.id })}
      <span className='truncate'>{label}</span>
      {entity.transport ? (
        <>
          <span className='text-muted-foreground'>·</span>
          <span className='text-muted-foreground text-xs uppercase'>{entity.transport}</span>
        </>
      ) : null}
    </>
  ),
  watchlist: (entity, label) => (
    <>
      {renderEntityBadge({ icon: ListChecks, entityId: entity.id })}
      <span className='truncate'>{label}</span>
    </>
  ),
}

const renderMainOptionIcon = (option: MentionOption) => {
  if (option === 'chats') {
    return <Bot className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (isCopilotWorkspaceEntityMentionOption(option)) {
    return renderWorkspaceEntityMainOptionIcon(option)
  }

  if (option === 'blocks') {
    return <Blocks className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'workflow_blocks') {
    return <Box className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'knowledge') {
    return <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'docs') {
    return <BookOpen className='h-3.5 w-3.5 text-muted-foreground' />
  }

  if (option === 'logs') {
    return <SquareChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
  }

  return <div className='h-3.5 w-3.5' />
}

const renderMentionItemContent = (
  type: MentionSubmenu,
  item: MentionItem,
  monitorCopy: ReturnType<typeof useMonitorCopy>['copy'],
  mentionCopy: CopilotMentionCopy
) => {
  if (type === 'chats') {
    const chat = item as PastChatItem
    return (
      <>
        <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
          <Bot className='h-3.5 w-3.5 text-muted-foreground' strokeWidth={1.5} />
        </div>
        <span className='truncate'>{getPastChatMentionLabel(mentionCopy, chat)}</span>
      </>
    )
  }

  if (isCopilotWorkspaceEntityMentionOption(type)) {
    const entity = item as WorkspaceEntityItem
    return WORKSPACE_ENTITY_ITEM_RENDERERS[entity.entityKind](
      entity,
      getWorkspaceEntityMentionLabel(mentionCopy, entity)
    )
  }

  if (type === 'knowledge') {
    const knowledgeBase = item as KnowledgeBaseItem
    return (
      <>
        <LibraryBig className='h-3.5 w-3.5 text-muted-foreground' />
        <span className='truncate'>{getKnowledgeBaseMentionLabel(knowledgeBase)}</span>
      </>
    )
  }

  if (type === 'blocks') {
    const block = item as BlockItem
    return (
      <>
        {renderBlockIcon(block)}
        <span className='truncate'>{block.name || block.id}</span>
      </>
    )
  }

  if (type === 'workflow_blocks') {
    const block = item as WorkflowBlockItem
    return (
      <>
        {renderBlockIcon(block)}
        <span className='truncate'>{block.name || block.id}</span>
      </>
    )
  }

  if (type === 'logs') {
    const log = item as LogItem
    return (
      <>
        {log.level === 'error' ? (
          <X className='h-3.5 w-3.5 text-red-500' />
        ) : (
          <Check className='h-3.5 w-3.5 text-green-500' />
        )}
        <span className='min-w-0 truncate'>{log.entityName}</span>
        <span className='text-muted-foreground'>·</span>
        <span className='whitespace-nowrap'>{formatTimestamp(log.startedAt)}</span>
        <span className='text-muted-foreground'>·</span>
        <span className='capitalize'>{getLogMentionTriggerLabel(monitorCopy, log)}</span>
      </>
    )
  }

  return null
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
  const mentionCopy = useCopilotMentionCopy()
  const { copy: monitorCopy } = useMonitorCopy()

  if (!showMentionMenu || !mentionPortalStyle) {
    return null
  }

  const filteredOptions = filterMentionOptions(mentionQuery, mentionCopy)
  const aggregatedItems = buildAggregatedMentionItems(
    mentionQuery,
    sources,
    monitorCopy,
    mentionCopy
  )
  const showAggregatedSearch = mentionQuery.length > 0 && filteredOptions.length === 0
  const submenuItems = openSubmenuFor
    ? filterMentionItems(openSubmenuFor, sources, submenuQuery, monitorCopy, mentionCopy)
    : []

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
              {getMentionSubmenuTitle(mentionCopy, openSubmenuFor)}
            </div>
            <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
              {loading[openSubmenuFor] ? (
                <div className='px-2 py-2 text-muted-foreground text-sm'>{mentionCopy.loading}</div>
              ) : submenuItems.length === 0 ? (
                <div className='px-2 py-2 text-muted-foreground text-sm'>
                  {mentionCopy.emptyStates[openSubmenuFor]}
                </div>
              ) : (
                submenuItems.map((item, index) => (
                  <div
                    key={`${openSubmenuFor}-${(item as any).id || (item as any).reviewSessionId || index}`}
                    data-idx={index}
                    className={cn(
                      'flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
                      submenuActiveIndex === index && 'bg-muted'
                    )}
                    role='menuitem'
                    aria-selected={submenuActiveIndex === index}
                    onMouseDown={preserveEditorSelection}
                    onMouseEnter={() => onSubmenuItemHover(index)}
                    onClick={() => onSelectSubmenuItem(openSubmenuFor, item)}
                  >
                    {renderMentionItemContent(openSubmenuFor, item, monitorCopy, mentionCopy)}
                  </div>
                ))
              )}
            </div>
          </>
        ) : showAggregatedSearch ? (
          <div ref={menuListRef} className='flex-1 overflow-auto overscroll-contain'>
            {aggregatedItems.length === 0 ? (
              <div className='px-2 py-2 text-muted-foreground text-sm'>{mentionCopy.noMatches}</div>
            ) : (
              aggregatedItems.map((item, index) => (
                <div
                  key={`${item.type}-${item.id}`}
                  data-idx={index}
                  className={cn(
                    'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
                    submenuActiveIndex === index && 'bg-muted'
                  )}
                  role='menuitem'
                  aria-selected={submenuActiveIndex === index}
                  onMouseDown={preserveEditorSelection}
                  onMouseEnter={() => onAggregatedItemHover(index)}
                  onClick={() => onSelectAggregatedItem(item)}
                >
                  {renderMentionItemContent(item.type, item.value, monitorCopy, mentionCopy)}
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
                  'flex cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted',
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
                  <span>{getMentionOptionLabel(mentionCopy, option)}</span>
                </div>
                {option !== 'docs' && (
                  <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                )}
              </div>
            ))}

            {mentionQuery.length > 0 && aggregatedItems.length > 0 && (
              <>
                <div className='my-1 h-px bg-border/70' />
                <div className='px-2 py-1 text-[11px] text-muted-foreground'>
                  {mentionCopy.matches}
                </div>
                {aggregatedItems.map((item, index) => (
                  <div
                    key={`${item.type}-${item.id}`}
                    data-idx={filteredOptions.length + index}
                    className={cn(
                      'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted',
                      inAggregated && submenuActiveIndex === index && 'bg-muted'
                    )}
                    role='menuitem'
                    aria-selected={inAggregated && submenuActiveIndex === index}
                    onMouseDown={preserveEditorSelection}
                    onMouseEnter={() => onAggregatedItemHover(index)}
                    onClick={() => onSelectAggregatedItem(item)}
                  >
                    {renderMentionItemContent(item.type, item.value, monitorCopy, mentionCopy)}
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
