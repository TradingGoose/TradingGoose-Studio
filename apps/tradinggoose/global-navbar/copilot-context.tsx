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
import type { DashboardLayoutTab } from '@/lib/dashboard-layouts/operations'
import type { ChatContext } from '@/stores/copilot/types'
import { buildCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'

type PublishedContext = { owner: symbol; context: ChatContext }
type PublishedActiveDashboardLayout = { owner: symbol; activeLayout: DashboardLayoutTab }

type GlobalCopilotContextValue = {
  currentContext: ChatContext | null
  activeDashboardLayout: DashboardLayoutTab | null
  setPublishedContext: Dispatch<SetStateAction<PublishedContext | null>>
  setPublishedActiveDashboardLayout: Dispatch<SetStateAction<PublishedActiveDashboardLayout | null>>
}

const GlobalCopilotContext = createContext<GlobalCopilotContextValue | null>(null)

export function resolveGlobalCopilotRouteContext(
  segments: string[],
  workspaceId: string
): ChatContext | null {
  const [routeWorkspaceId, section, knowledgeBaseId] = segments
  if (routeWorkspaceId !== workspaceId || section !== 'knowledge' || !knowledgeBaseId) {
    return null
  }

  return buildCopilotWorkspaceEntityContext({
    entityKind: 'knowledge_base',
    entityId: knowledgeBaseId,
    workspaceId,
    label: 'Current knowledge base',
    current: true,
  })
}

export function GlobalCopilotContextProvider({ children }: { children: ReactNode }) {
  const [publishedContext, setPublishedContext] = useState<PublishedContext | null>(null)
  const [publishedActiveDashboardLayout, setPublishedActiveDashboardLayout] =
    useState<PublishedActiveDashboardLayout | null>(null)
  const value = useMemo(
    () => ({
      currentContext: publishedContext?.context ?? null,
      activeDashboardLayout: publishedActiveDashboardLayout?.activeLayout ?? null,
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

export function GlobalCopilotContextPublisher({ context }: { context: ChatContext | null }) {
  const setPublishedContext = useContext(GlobalCopilotContext)?.setPublishedContext
  const ownerRef = useRef(Symbol('global-copilot-context'))

  useLayoutEffect(() => {
    if (!context || !setPublishedContext) return
    const owner = ownerRef.current
    setPublishedContext({ owner, context })
    return () => setPublishedContext((current) => (current?.owner === owner ? null : current))
  }, [context, setPublishedContext])

  return null
}

export function GlobalCopilotActiveDashboardLayoutPublisher({
  activeLayout,
}: {
  activeLayout: DashboardLayoutTab | null
}) {
  const setPublishedActiveDashboardLayout =
    useContext(GlobalCopilotContext)?.setPublishedActiveDashboardLayout
  const ownerRef = useRef(Symbol('global-copilot-active-dashboard-layout'))

  useLayoutEffect(() => {
    if (!activeLayout || !setPublishedActiveDashboardLayout) return
    const owner = ownerRef.current
    setPublishedActiveDashboardLayout({ owner, activeLayout })
    return () =>
      setPublishedActiveDashboardLayout((current) => (current?.owner === owner ? null : current))
  }, [activeLayout, setPublishedActiveDashboardLayout])

  return null
}
