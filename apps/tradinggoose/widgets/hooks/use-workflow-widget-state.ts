'use client'

import { useEffect, useMemo } from 'react'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'

type UseWorkflowWidgetStateOptions = Pick<
  WidgetComponentProps,
  'params' | 'pairColor' | 'panelId' | 'widget'
> & {
  workspaceId?: string
  fallbackWidgetKey: string
  loggerScope?: string
  activateWorkflow?: boolean
  usePairWorkflowContext?: boolean
}

export type WorkflowWidgetLoadError =
  | 'unableToLoadWorkflows'
  | 'authenticationRequiredToLoadWorkflows'

type UseWorkflowWidgetStateResult = {
  resolvedPairColor: PairColor
  channelId: string
  requestedWorkflowId: string | null
  resolvedWorkflowId: string | null
  hasLoadedWorkflows: boolean
  loadError: WorkflowWidgetLoadError | null
  isLoading: boolean
  workflowIds: string[]
  activeWorkflowIdForChannel: string | null
}

const EMPTY_PAIR_CONTEXT: Readonly<PairColorContext> = Object.freeze({})

export const useWorkflowWidgetState = ({
  workspaceId,
  pairColor,
  widget,
  panelId,
  params,
  fallbackWidgetKey,
  loggerScope = 'workflow widget',
  activateWorkflow = true,
  usePairWorkflowContext = true,
}: UseWorkflowWidgetStateOptions): UseWorkflowWidgetStateResult => {
  const { resolvedPairColor, channelId } = resolveWidgetChannel({
    pairColor,
    widget,
    panelId,
    fallbackWidgetKey,
  })
  const shouldUsePairWorkflowContext = usePairWorkflowContext && resolvedPairColor !== 'gray'
  const pairContext = usePairColorStore((state) =>
    shouldUsePairWorkflowContext ? state.contexts[resolvedPairColor] : EMPTY_PAIR_CONTEXT
  )
  const {
    members,
    isLoading: isListLoading,
    error: listError,
  } = useEntityList('workflow', workspaceId)
  const setActiveWorkflow = useWorkflowRegistry((state) => state.setActiveWorkflow)

  const requestedWorkflowId = useMemo(() => {
    if (
      (resolvedPairColor !== 'gray' && shouldUsePairWorkflowContext) ||
      !params ||
      typeof params !== 'object'
    ) {
      return null
    }

    return 'workflowId' in params && params.workflowId ? String(params.workflowId) : null
  }, [resolvedPairColor, params, shouldUsePairWorkflowContext])

  const rawActiveWorkflowIdForChannel = useWorkflowRegistry((state) =>
    state.getActiveWorkflowId(channelId)
  )
  const isChannelHydrating = useWorkflowRegistry((state) => state.isChannelHydrating(channelId))

  const workflowIds = useMemo(() => members.map((member) => member.entityId), [members])
  const hasLoadedWorkflows = !workspaceId || Boolean(listError) || !isListLoading
  const canResolveWorkflowIds = Boolean(workspaceId) && !listError && !isListLoading

  const resolvedWorkflowId = useMemo(() => {
    const resolveWorkflowId = (workflowId: string | null | undefined) => {
      if (!workflowId) return null
      return canResolveWorkflowIds && workflowIds.includes(workflowId) ? workflowId : null
    }

    if (shouldUsePairWorkflowContext) {
      return resolveWorkflowId(pairContext.workflowId)
    }

    return (
      resolveWorkflowId(rawActiveWorkflowIdForChannel) ?? resolveWorkflowId(requestedWorkflowId)
    )
  }, [
    workflowIds,
    pairContext.workflowId,
    rawActiveWorkflowIdForChannel,
    requestedWorkflowId,
    canResolveWorkflowIds,
    shouldUsePairWorkflowContext,
  ])

  const activeWorkflowIdForChannel = activateWorkflow
    ? rawActiveWorkflowIdForChannel
    : resolvedWorkflowId

  useEffect(() => {
    if (!activateWorkflow) {
      return
    }

    if (!resolvedWorkflowId || activeWorkflowIdForChannel === resolvedWorkflowId) {
      return
    }

    setActiveWorkflow({ workflowId: resolvedWorkflowId, channelId }).catch((error) => {
      console.error(`Failed to activate workflow for ${loggerScope}`, error)
    })
  }, [
    activateWorkflow,
    resolvedWorkflowId,
    activeWorkflowIdForChannel,
    setActiveWorkflow,
    channelId,
    loggerScope,
  ])

  const loadError: WorkflowWidgetLoadError | null = listError ? 'unableToLoadWorkflows' : null

  return {
    resolvedPairColor,
    channelId,
    requestedWorkflowId,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading: isListLoading || isChannelHydrating,
    workflowIds,
    activeWorkflowIdForChannel: activeWorkflowIdForChannel ?? null,
  }
}
