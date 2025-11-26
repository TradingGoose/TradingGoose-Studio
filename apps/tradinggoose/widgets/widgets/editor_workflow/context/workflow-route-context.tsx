'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store-client'

interface WorkflowRouteContextValue {
  workspaceId: string
  workflowId: string
  channelId: string
}

const WorkflowRouteContext = createContext<WorkflowRouteContextValue | null>(null)

interface WorkflowRouteProviderProps {
  workspaceId: string
  workflowId: string
  channelId?: string
  children: ReactNode
}

export function WorkflowRouteProvider({
  workspaceId,
  workflowId,
  channelId = DEFAULT_WORKFLOW_CHANNEL_ID,
  children,
}: WorkflowRouteProviderProps) {
  const value = useMemo(
    () => ({
      workspaceId,
      workflowId,
      channelId,
    }),
    [workspaceId, workflowId, channelId]
  )

  return <WorkflowRouteContext.Provider value={value}>{children}</WorkflowRouteContext.Provider>
}

export function useWorkflowRoute() {
  const context = useContext(WorkflowRouteContext)
  if (!context) {
    throw new Error('useWorkflowRoute must be used within a WorkflowRouteProvider')
  }

  return context
}

export function useOptionalWorkflowRoute() {
  return useContext(WorkflowRouteContext)
}

export function useWorkspaceId() {
  return useWorkflowRoute().workspaceId
}

export function useWorkflowId() {
  return useWorkflowRoute().workflowId
}

export function useWorkflowChannelId() {
  return useWorkflowRoute().channelId
}
