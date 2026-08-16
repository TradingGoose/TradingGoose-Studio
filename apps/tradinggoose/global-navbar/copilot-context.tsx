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
import { buildCopilotWorkspaceEntityContext } from '@/lib/copilot/workspace-entities'
import type { ChatContext } from '@/stores/copilot/types'

type PublishedValue<T> = { owner: symbol; value: T }

type GlobalCopilotContextValue = {
  currentContext: ChatContext | null
  setPublishedContext: Dispatch<SetStateAction<PublishedValue<ChatContext> | null>>
}

const GlobalCopilotContext = createContext<GlobalCopilotContextValue | null>(null)

export function GlobalCopilotContextProvider({ children }: { children: ReactNode }) {
  const [publishedContext, setPublishedContext] = useState<PublishedValue<ChatContext> | null>(null)
  const value = useMemo(
    () => ({
      currentContext: publishedContext?.value ?? null,
      setPublishedContext,
    }),
    [publishedContext]
  )

  return <GlobalCopilotContext.Provider value={value}>{children}</GlobalCopilotContext.Provider>
}

function useGlobalCopilotContextValue() {
  const value = useContext(GlobalCopilotContext)
  if (!value) {
    throw new Error('Global Copilot context requires GlobalCopilotContextProvider')
  }
  return value
}

export function useGlobalCopilotCurrentContext() {
  return useGlobalCopilotContextValue().currentContext
}

function useGlobalCopilotPublisher<T>(
  value: T | null,
  setPublished: Dispatch<SetStateAction<PublishedValue<T> | null>> | undefined
) {
  const owner = useRef(Symbol('global-copilot-publisher')).current

  useLayoutEffect(() => {
    if (value === null || !setPublished) return
    setPublished({ owner, value })
    return () => setPublished((current) => (current?.owner === owner ? null : current))
  }, [owner, setPublished, value])
}

export function GlobalCopilotContextPublisher({ context }: { context: ChatContext | null }) {
  const setPublishedContext = useContext(GlobalCopilotContext)?.setPublishedContext
  useGlobalCopilotPublisher(context, setPublishedContext)

  return null
}

export function GlobalCopilotKnowledgeContextPublisher({
  knowledgeBaseId,
  workspaceId,
}: {
  knowledgeBaseId: string
  workspaceId: string
}) {
  const context = useMemo(
    () =>
      buildCopilotWorkspaceEntityContext({
        entityKind: 'knowledge_base',
        entityId: knowledgeBaseId,
        workspaceId,
        label: 'Current knowledge base',
        current: true,
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
  const context = useMemo(
    () =>
      layoutId
        ? buildCopilotWorkspaceEntityContext({
            entityKind: 'dashboard_layout',
            entityId: layoutId,
            workspaceId,
            ownerUserId,
            label: layoutName?.trim() || layoutId,
            current: true,
          })
        : null,
    [layoutId, layoutName, ownerUserId, workspaceId]
  )

  return <GlobalCopilotContextPublisher context={context} />
}
