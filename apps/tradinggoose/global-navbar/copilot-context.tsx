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
import type { DashboardLayoutTab } from '@/lib/dashboard-layouts/operations'
import type { ChatContext } from '@/stores/copilot/types'

type PublishedValue<T> = { owner: symbol; value: T }

type GlobalCopilotContextValue = {
  currentContext: ChatContext | null
  activeDashboardLayout: DashboardLayoutTab | null
  setPublishedContext: Dispatch<SetStateAction<PublishedValue<ChatContext> | null>>
  setPublishedActiveDashboardLayout: Dispatch<
    SetStateAction<PublishedValue<DashboardLayoutTab> | null>
  >
}

const GlobalCopilotContext = createContext<GlobalCopilotContextValue | null>(null)

export function GlobalCopilotContextProvider({ children }: { children: ReactNode }) {
  const [publishedContext, setPublishedContext] = useState<PublishedValue<ChatContext> | null>(null)
  const [publishedActiveDashboardLayout, setPublishedActiveDashboardLayout] =
    useState<PublishedValue<DashboardLayoutTab> | null>(null)
  const value = useMemo(
    () => ({
      currentContext: publishedContext?.value ?? null,
      activeDashboardLayout: publishedActiveDashboardLayout?.value ?? null,
      setPublishedContext,
      setPublishedActiveDashboardLayout,
    }),
    [publishedActiveDashboardLayout, publishedContext]
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

export function useGlobalCopilotActiveDashboardLayout() {
  return useGlobalCopilotContextValue().activeDashboardLayout
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

export function GlobalCopilotActiveDashboardLayoutPublisher({
  activeLayout,
}: {
  activeLayout: DashboardLayoutTab | null
}) {
  const setPublishedActiveDashboardLayout =
    useContext(GlobalCopilotContext)?.setPublishedActiveDashboardLayout
  useGlobalCopilotPublisher(activeLayout, setPublishedActiveDashboardLayout)

  return null
}
