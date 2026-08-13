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
import { buildCopilotWorkspaceEntityContext } from '@/widgets/widgets/copilot/workspace-entities'

type PublishedContext = { owner: symbol; context: ChatContext }

type GlobalCopilotContextValue = {
  currentContext: ChatContext | null
  setPublishedContext: Dispatch<SetStateAction<PublishedContext | null>>
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
  const value = useMemo(
    () => ({ currentContext: publishedContext?.context ?? null, setPublishedContext }),
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
