'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Clock3, Plus, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useShallow } from 'zustand/react/shallow'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'
import { formatTemplate, type LocaleCode } from '@/i18n/utils'
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'
import { useCopilotStore, useCopilotStoreApi } from '@/stores/copilot/store'
import type { CopilotChat } from '@/stores/copilot/types'

type CopilotHistoryMessages = ReturnType<typeof useCopilotMessages>['history']
const CHAT_MENU_PAGE_SIZE = 40

type ChatGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'older'

const formatRelativeTime = (
  value: Date | string | undefined,
  locale: LocaleCode,
  historyCopy: CopilotHistoryMessages
) => {
  if (!value) return ''

  const date = value instanceof Date ? value : new Date(value)
  const diffMs = Date.now() - date.getTime()
  if (!Number.isFinite(diffMs)) return ''

  const minutes = Math.floor(diffMs / (1000 * 60))
  if (minutes < 1) return historyCopy.justNow

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (minutes < 60) return formatter.format(-minutes, 'minute')

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return formatter.format(-hours, 'hour')

  const days = Math.floor(hours / 24)
  if (days < 14) return formatter.format(-days, 'day')

  return new Intl.DateTimeFormat(locale).format(date)
}

const groupChats = (chats: CopilotChat[], limit: number) => {
  if (chats.length === 0) return [] as Array<[ChatGroupKey, CopilotChat[]]>
  const sorted = [...chats].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const thisWeekStart = new Date(today.getTime() - today.getDay() * 24 * 60 * 60 * 1000)
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const groups: Record<ChatGroupKey, CopilotChat[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    lastWeek: [],
    older: [],
  }

  sorted.slice(0, limit).forEach((chat) => {
    const chatDate = new Date(chat.updatedAt)
    const chatDay = new Date(chatDate.getFullYear(), chatDate.getMonth(), chatDate.getDate())

    if (chatDay.getTime() === today.getTime()) {
      groups.today.push(chat)
    } else if (chatDay.getTime() === yesterday.getTime()) {
      groups.yesterday.push(chat)
    } else if (chatDay.getTime() >= thisWeekStart.getTime()) {
      groups.thisWeek.push(chat)
    } else if (chatDay.getTime() >= lastWeekStart.getTime()) {
      groups.lastWeek.push(chat)
    } else {
      groups.older.push(chat)
    }
  })

  return Object.entries(groups).filter(([, list]) => list.length > 0) as Array<
    [ChatGroupKey, CopilotChat[]]
  >
}

interface ChatHistoryGroupProps {
  label: string
  chats: CopilotChat[]
  onSelect: (chat: CopilotChat) => Promise<void> | void
  onDelete: (chatId: string) => Promise<void> | void
  isSendingMessage: boolean
  locale: LocaleCode
  historyCopy: CopilotHistoryMessages
}

interface ChatHistoryItemProps {
  chat: CopilotChat
  onSelect: (chat: CopilotChat) => Promise<void> | void
  onDelete: (chatId: string) => Promise<void> | void
  isSendingMessage: boolean
  locale: LocaleCode
  historyCopy: CopilotHistoryMessages
}

function ChatHistoryItem({
  chat,
  onSelect,
  onDelete,
  isSendingMessage,
  locale,
  historyCopy,
}: ChatHistoryItemProps) {
  const updatedLabel = formatTemplate(
    historyCopy.updated,
    { value: formatRelativeTime(chat.updatedAt, locale, historyCopy) },
    locale
  )

  return (
    <div className='group flex w-full items-center'>
      <DropdownMenuItem
        className='min-w-0 flex-1 justify-between rounded-xs py-2 text-left font-normal text-foreground text-sm transition-colors data-[highlighted]:bg-muted'
        closeOnClick={false}
        onClick={() => {
          void onSelect(chat)
        }}
      >
        <div className='min-w-0'>
          <p className='min-w-0 whitespace-normal break-words text-foreground'>
            {chat.title || historyCopy.newChat}
          </p>
          <p className='text-muted-foreground text-xs'>{updatedLabel}</p>
        </div>

        <button
          type='button'
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onDelete(chat.threadId)
          }}
          disabled={isSendingMessage}
          aria-label={historyCopy.deleteChatAria}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center gap-2 whitespace-nowrap rounded-md p-0 font-medium text-muted-foreground text-sm ring-offset-background transition-opacity hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
            'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100'
          )}
        >
          <Trash2 className='h-3.5 w-3.5' />
        </button>
      </DropdownMenuItem>
    </div>
  )
}

function ChatHistoryGroup({
  label,
  chats,
  onSelect,
  onDelete,
  isSendingMessage,
  locale,
  historyCopy,
}: ChatHistoryGroupProps) {
  return (
    <div className='space-y-1.5'>
      <p className='font-normal text-muted-foreground text-xs'>{label}</p>
      <div className='space-y-1'>
        {chats.map((chat) => (
          <ChatHistoryItem
            key={chat.threadId}
            chat={chat}
            onSelect={onSelect}
            onDelete={onDelete}
            isSendingMessage={isSendingMessage}
            locale={locale}
            historyCopy={historyCopy}
          />
        ))}
      </div>
    </div>
  )
}

export function CopilotHeader({ workspaceId }: { workspaceId: string }) {
  const store = useCopilotStoreApi()
  const locale = useLocale() as LocaleCode
  const historyCopy = useCopilotMessages().history
  const [limit, setLimit] = useState(CHAT_MENU_PAGE_SIZE)
  const [deleteChatId, setDeleteChatId] = useState<string | null>(null)

  const retry = useTranslations('workspace.widgets.stateMessage')('retry')
  const { currentChat, chats, chatsError, chatsWorkspaceId, isLoadingChats, isSendingMessage } =
    useCopilotStore(
      useShallow(
        ({
          currentChat,
          chats,
          chatsError,
          chatsWorkspaceId,
          isLoadingChats,
          isSendingMessage,
        }) => ({
          currentChat,
          chats,
          chatsError,
          chatsWorkspaceId,
          isLoadingChats,
          isSendingMessage,
        })
      )
    )
  const listInScope = chatsWorkspaceId === workspaceId
  const grouped = useMemo(
    () => (listInScope ? groupChats(chats, limit) : []),
    [chats, limit, listInScope]
  )
  const loadChats = () => store.getState().loadChats({ workspaceId })
  const groupLabels: Record<ChatGroupKey, string> = {
    today: historyCopy.groups.today,
    yesterday: historyCopy.groups.yesterday,
    thisWeek: historyCopy.groups.thisWeek,
    lastWeek: historyCopy.groups.lastWeek,
    older: historyCopy.groups.older,
  }

  const handleSelectChat = async (chat: CopilotChat) => {
    if (currentChat?.threadId === chat.threadId) return
    try {
      await store.getState().selectChat(chat)
    } catch {}
  }

  const title =
    (currentChat?.workspaceId === workspaceId && currentChat.title) || historyCopy.newChat
  const deleteChat =
    listInScope && deleteChatId ? chats.find((chat) => chat.threadId === deleteChatId) : null

  const dropdownMenuBody = (() => {
    if (!listInScope || (isLoadingChats && grouped.length === 0 && !chatsError)) {
      return <div className='p-3 text-muted-foreground text-sm'>{historyCopy.loading}</div>
    }

    if (grouped.length === 0 && !chatsError) {
      return <div className='p-3 text-muted-foreground text-sm'>{historyCopy.noChatsYet}</div>
    }

    return (
      <div className='space-y-4 p-2'>
        {chatsError && (
          <div>
            <p role='alert' className='text-destructive text-sm'>
              {historyCopy.loadError} {chatsError}
            </p>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={isLoadingChats}
              onClick={() => void loadChats()}
            >
              {retry}
            </DropdownMenuItem>
          </div>
        )}
        {grouped.map(([groupKey, chatsInGroup]) => (
          <ChatHistoryGroup
            key={groupKey}
            label={groupLabels[groupKey]}
            chats={chatsInGroup}
            onSelect={handleSelectChat}
            onDelete={setDeleteChatId}
            isSendingMessage={isSendingMessage}
            locale={locale}
            historyCopy={historyCopy}
          />
        ))}
        {chats.length > limit && (
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => setLimit((count) => count + CHAT_MENU_PAGE_SIZE)}
          >
            {historyCopy.showOlderChats}
          </DropdownMenuItem>
        )}
      </div>
    )
  })()

  return (
    <div className='flex w-full min-w-0 items-center gap-2'>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void loadChats()
          else setLimit(CHAT_MENU_PAGE_SIZE)
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='inline-flex'>
                <DropdownMenuTrigger
                  render={
                    <button
                      type='button'
                      className={widgetHeaderControlClassName(
                        'group flex w-[240px] shrink-0 items-center justify-between gap-1'
                      )}
                      aria-label={historyCopy.openChatHistory}
                    />
                  }
                >
                  <div className='rounded-xs bg-muted p-1'>
                    <Clock3 className='h-3 w-3 text-muted-foreground' />
                  </div>
                  <span className='min-w-0 flex-1 truncate text-left font-medium text-sm'>
                    {title}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      'group-data-[popup-open]:rotate-180'
                    )}
                  />
                </DropdownMenuTrigger>
              </span>
            }
          />
          <TooltipContent side='top'>{title}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side='bottom'
          sideOffset={6}
          className='w-[var(--anchor-width)] overflow-hidden rounded-sm bg-background p-0 text-foreground text-sm shadow-xs'
        >
          <ScrollArea className='max-h-72 bg-background pr-1 text-foreground text-sm'>
            {dropdownMenuBody}
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={!!deleteChat}
        onOpenChange={(open) => {
          if (!open) setDeleteChatId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{historyCopy.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {formatTemplate(
                historyCopy.deleteDialogDescription,
                { title: deleteChat?.title || historyCopy.untitledCurrentChat },
                locale
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{historyCopy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-destructive-foreground [&:not([data-disabled])]:hover:bg-destructive/70'
              onClick={async () => {
                if (!deleteChatId) return
                try {
                  await store.getState().deleteChat(deleteChatId)
                } catch {}
                setDeleteChatId(null)
              }}
            >
              {historyCopy.deleteAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function CopilotHeaderActions({ workspaceId }: { workspaceId: string }) {
  const store = useCopilotStoreApi()
  const historyCopy = useCopilotMessages().history
  const isSendingMessage = useCopilotStore((state) => state.isSendingMessage)

  const tooltip = isSendingMessage ? historyCopy.sending : historyCopy.newChat

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className='inline-flex'>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              onClick={() => void store.getState().createNewChat(workspaceId)}
              disabled={isSendingMessage}
              aria-label={historyCopy.startNewChat}
            >
              <Plus className='h-3.5 w-3.5' />
            </button>
          </span>
        }
      />
      <TooltipContent side='top'>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
