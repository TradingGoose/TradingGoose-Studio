'use client'

import { useCallback, useMemo } from 'react'
import { ChevronDown, Clock3, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getCopilotStore } from '@/stores/copilot/store'
import type { CopilotChat } from '@/stores/copilot/types'
import { useSyncExternalStore } from 'react'
import {
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/shared/components/widget-header-control'

const formatRelativeTime = (value: Date | string | undefined) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / (1000 * 60))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d ago`
  return date.toLocaleDateString()
}

const groupChats = (chats: CopilotChat[]) => {
  if (!chats || chats.length === 0) return [] as Array<[string, CopilotChat[]]>
  const sorted = [...chats].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const thisWeekStart = new Date(today.getTime() - today.getDay() * 24 * 60 * 60 * 1000)
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const groups: Record<string, CopilotChat[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    'Last Week': [],
    Older: [],
  }

  sorted.forEach((chat) => {
    const chatDate = new Date(chat.updatedAt)
    const chatDay = new Date(chatDate.getFullYear(), chatDate.getMonth(), chatDate.getDate())

    if (chatDay.getTime() === today.getTime()) {
      groups.Today.push(chat)
    } else if (chatDay.getTime() === yesterday.getTime()) {
      groups.Yesterday.push(chat)
    } else if (chatDay.getTime() >= thisWeekStart.getTime()) {
      groups['This Week'].push(chat)
    } else if (chatDay.getTime() >= lastWeekStart.getTime()) {
      groups['Last Week'].push(chat)
    } else {
      groups.Older.push(chat)
    }
  })

  return Object.entries(groups).filter(([, list]) => list.length > 0)
}

export function CopilotHeader({ channelId }: { channelId: string }) {
  const store = useMemo(() => getCopilotStore(channelId), [channelId])

  const subscribe = useCallback(store.subscribe, [store])
  const getSnapshot = useCallback(() => store.getState(), [store])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const { currentChat, chats, isLoadingChats, isSendingMessage } = state
  const grouped = groupChats(chats || [])

  const handleSelectChat = async (chat: CopilotChat) => {
    if (currentChat?.id === chat.id) return
    try {
      await store.getState().selectChat(chat)
    } catch { }
  }

  const handleDeleteChat = async (chatId: string) => {
    try {
      await store.getState().deleteChat(chatId)
    } catch { }
  }

  const handleRefresh = async () => {
    const wf = store.getState().workflowId
    if (!wf) return
    await store.getState().loadChats(true)
  }

  const title = currentChat?.title || 'New Chat'

  return (
    <div className='flex items-center gap-2'>
      <DropdownMenu onOpenChange={(open) => open && handleRefresh()}>
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className={widgetHeaderControlClassName('flex w-full items-center gap-2 min-w-0')}
            aria-label='Open chat history'
          >
            <Clock3 className='h-4 w-4 text-muted-foreground' />
            <span className='min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground'>
              {title}
            </span>
            <ChevronDown className='h-4 w-4 text-muted-foreground' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-72 p-0'>
          <ScrollArea className='max-h-72'>
            <div className='divide-y divide-border/50'>
              {isLoadingChats ? (
                <div className='p-3 text-sm text-muted-foreground'>Loading…</div>
              ) : grouped.length === 0 ? (
                <div className='p-3 text-sm text-muted-foreground'>No chats yet</div>
              ) : (
                grouped.map(([label, chatsInGroup]) => (
                  <div key={label}>
                    <div className='bg-muted/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                      {label}
                    </div>
                    <div className='flex flex-col'>
                      {chatsInGroup.map((chat) => (
                        <DropdownMenuItem
                          key={chat.id}
                          className='flex items-center justify-between gap-2'
                          onSelect={(event) => {
                            event.preventDefault()
                            void handleSelectChat(chat)
                          }}
                        >
                          <div className='min-w-0'>
                            <p className='truncate text-sm font-medium text-foreground'>
                              {chat.title || 'New Chat'}
                            </p>
                            <p className='text-[11px] text-muted-foreground'>
                              Updated {formatRelativeTime(chat.updatedAt)}
                            </p>
                          </div>
                          <button
                            type='button'
                            className={widgetHeaderIconButtonClassName()}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              void handleDeleteChat(chat.id)
                            }}
                            disabled={isSendingMessage}
                            aria-label='Delete chat'
                          >
                            <span className='text-sm leading-none'>×</span>
                          </button>
                        </DropdownMenuItem>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>

    </div>
  )
}

export function CopilotHeaderActions({ channelId }: { channelId: string }) {
  const store = useMemo(() => getCopilotStore(channelId), [channelId])

  const subscribe = useCallback(store.subscribe, [store])
  const getSnapshot = useCallback(() => store.getState(), [store])
  const { isSendingMessage, workflowId } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const handleNewChat = async () => {
    if (!workflowId) return
    await store.getState().createNewChat()
  }

  return (
    <button
      type='button'
      className={widgetHeaderIconButtonClassName()}
      onClick={handleNewChat}
      disabled={isSendingMessage || !workflowId}
      aria-label='Start new chat'
      title={isSendingMessage ? 'Sending…' : 'New chat'}
    >
      <Plus className='h-3.5 w-3.5' />
    </button>
  )
}
