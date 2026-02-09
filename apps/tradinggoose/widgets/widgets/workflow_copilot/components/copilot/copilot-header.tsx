'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, Clock3, Plus, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getCopilotStore } from '@/stores/copilot/store'
import type { CopilotChat } from '@/stores/copilot/types'
import { useSyncExternalStore } from 'react'
import {
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

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

interface ChatHistoryGroupProps {
  label: string
  chats: CopilotChat[]
  onSelect: (chat: CopilotChat) => Promise<void> | void
  onDelete: (chatId: string) => Promise<void> | void
  isSendingMessage: boolean
  hoveredChatId: string | null
  onHoverChat: (chatId: string | null) => void
}

interface ChatHistoryItemProps {
  chat: CopilotChat
  onSelect: (chat: CopilotChat) => Promise<void> | void
  onDelete: (chatId: string) => Promise<void> | void
  isSendingMessage: boolean
  isHovered: boolean
  onHoverChat: (chatId: string | null) => void
}

function ChatHistoryItem({
  chat,
  onSelect,
  onDelete,
  isSendingMessage,
  isHovered,
  onHoverChat,
}: ChatHistoryItemProps) {
  return (
    <DropdownMenuItem
      className='group flex w-full items-center justify-between gap-3 rounded-xs py-2 text-left text-sm font-normal text-foreground transition-colors focus:bg-muted data-[highlighted]:bg-muted'
      onSelect={(event) => {
        event.preventDefault()
        void onSelect(chat)
      }}
      onMouseEnter={() => onHoverChat(chat.id)}
      onMouseLeave={() => onHoverChat(null)}
    >
      <div className='min-w-0'>
        <p className='min-w-0 whitespace-normal break-words text-foreground'>
          {chat.title || 'New Chat'}
        </p>
        <p className='text-xs text-muted-foreground'>Updated {formatRelativeTime(chat.updatedAt)}</p>
      </div>
      <button
        type='button'
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void onDelete(chat.id)
        }}
        disabled={isSendingMessage}
        aria-label='Delete chat'
        className={cn(
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-muted h-6 w-6 p-0 text-muted-foreground transition-opacity hover:text-destructive',
          isHovered ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <Trash2 className='h-3.5 w-3.5' />
      </button>
    </DropdownMenuItem >
  )
}

function ChatHistoryGroup({
  label,
  chats,
  onSelect,
  onDelete,
  isSendingMessage,
  hoveredChatId,
  onHoverChat,
}: ChatHistoryGroupProps) {
  if (chats.length === 0) return null

  return (
    <div className='space-y-1.5'>
      <p className='text-xs font-normal text-muted-foreground'>
        {label}
      </p>
      <div className='space-y-1'>
        {chats.map((chat) => (
          <ChatHistoryItem
            key={chat.id}
            chat={chat}
            onSelect={onSelect}
            onDelete={onDelete}
            isSendingMessage={isSendingMessage}
            isHovered={hoveredChatId === chat.id}
            onHoverChat={onHoverChat}
          />
        ))}
      </div>
    </div>
  )
}

export function CopilotHeader({ channelId }: { channelId: string }) {
  const store = useMemo(() => getCopilotStore(channelId), [channelId])
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null)
  const [deleteChatId, setDeleteChatId] = useState<string | null>(null)

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
    setDeleteChatId(chatId)
  }

  const handleRefresh = async () => {
    const wf = store.getState().workflowId
    if (!wf) return
    await store.getState().loadChats(true)
  }

  const title = currentChat?.title || 'New Chat'
  const deleteChat = deleteChatId ? chats.find((chat) => chat.id === deleteChatId) : null
  const dropdownMenuBody = (() => {
    if (isLoadingChats) {
      return <div className='p-3 text-sm text-muted-foreground'>Loading…</div>
    }

    if (grouped.length === 0) {
      return <div className='p-3 text-sm text-muted-foreground'>No chats yet</div>
    }

    return (
      <div className='space-y-4 p-2'>
        {grouped.map(([label, chatsInGroup]) => (
          <ChatHistoryGroup
            key={label}
            label={label}
            chats={chatsInGroup}
            onSelect={handleSelectChat}
            onDelete={handleDeleteChat}
            isSendingMessage={isSendingMessage}
            hoveredChatId={hoveredChatId}
            onHoverChat={setHoveredChatId}
          />
        ))}
      </div>
    )
  })()

  return (
    <div className='flex w-full min-w-0 items-center gap-2'>
      <DropdownMenu
        onOpenChange={(open) => {
          setIsMenuOpen(open)
          if (open) void handleRefresh()
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            className={widgetHeaderControlClassName(
              'flex items-center gap-1 min-w-[240px] justify-between'
            )}
            aria-label='Open chat history'
          >
            <div className='p-1 bg-muted rounded-xs'>
              <Clock3 className='h-3 w-3 text-muted-foreground' />
            </div>
            <span className='min-w-0 flex-1 truncate text-left text-sm font-medium'>
              {title}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                isMenuOpen ? 'rotate-180' : ''
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side='bottom'
          sideOffset={6}
          className='w-[var(--radix-dropdown-menu-trigger-width)] overflow-hidden rounded-sm bg-background p-0 text-sm text-foreground shadow-xs'
        >
          <ScrollArea className='max-h-72 bg-background pr-1 text-sm text-foreground'>
            {dropdownMenuBody}
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={!!deleteChatId}
        onOpenChange={(open) => {
          if (!open) setDeleteChatId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete <strong>{deleteChat?.title || 'this chat'}</strong>{' '}
              and all associated data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              onClick={async () => {
                if (!deleteChatId) return
                try {
                  await store.getState().deleteChat(deleteChatId)
                } catch { }
                setDeleteChatId(null)
              }}
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
