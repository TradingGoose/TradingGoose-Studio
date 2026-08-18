'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ChatContext } from '@/stores/copilot/types'

type PublishedContext = { owner: symbol; value: ChatContext | null }

type GlobalCopilotContextValue = {
  currentContext: ChatContext | null
  setPublishedContext: Dispatch<SetStateAction<PublishedContext | null>>
}

const GlobalCopilotContext = createContext<GlobalCopilotContextValue | null>(null)

export function GlobalCopilotContextProvider({ children }: { children: ReactNode }) {
  const [publishedContext, setPublishedContext] = useState<PublishedContext | null>(null)
  const value = useMemo(
    () => ({
      currentContext: publishedContext?.value ?? null,
      setPublishedContext,
    }),
    [publishedContext]
  )

  return <GlobalCopilotContext.Provider value={value}>{children}</GlobalCopilotContext.Provider>
}

export function useGlobalCopilotCurrentContext() {
  const value = useContext(GlobalCopilotContext)
  if (!value) {
    throw new Error('Global Copilot context requires GlobalCopilotContextProvider')
  }
  return value.currentContext
}

export function GlobalCopilotContextPublisher({ context }: { context: ChatContext | null }) {
  const setPublished = useContext(GlobalCopilotContext)?.setPublishedContext
  const owner = useRef(Symbol('global-copilot-publisher')).current

  useLayoutEffect(() => {
    if (!setPublished) return
    setPublished({ owner, value: context })
    return () => setPublished((current) => (current?.owner === owner ? null : current))
  }, [context, owner, setPublished])

  return null
}

export function GlobalCopilotKnowledgeContextPublisher({
  knowledgeBaseId,
  workspaceId,
}: {
  knowledgeBaseId: string
  workspaceId: string
}) {
  const context = useMemo<ChatContext>(
    () => ({
      kind: 'current_knowledge_base',
      knowledgeBaseId,
      workspaceId,
      label: 'Current knowledge base',
    }),
    [knowledgeBaseId, workspaceId]
  )

  return <GlobalCopilotContextPublisher context={context} />
}

export function GlobalCopilotDashboardContextPublisher({
  layoutId,
  layoutName,
  ownerUserId,
  workspaceId,
}: {
  layoutId: string | null
  layoutName: string | null
  ownerUserId: string
  workspaceId: string
}) {
  const context = useMemo<ChatContext | null>(
    () =>
      layoutId
        ? {
            kind: 'current_dashboard_layout',
            dashboardLayoutId: layoutId,
            workspaceId,
            ownerUserId,
            label: layoutName?.trim() || layoutId,
          }
        : null,
    [layoutId, layoutName, ownerUserId, workspaceId]
  )

  return <GlobalCopilotContextPublisher context={context} />
}
