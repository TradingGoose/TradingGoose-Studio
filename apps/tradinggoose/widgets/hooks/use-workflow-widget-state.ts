'use client'

import { useEffect, useMemo } from 'react'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { resolveEntityId, resolveEntityIdFromList } from '@/widgets/utils/entity-selection'

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

type UseWorkflowWidgetStateResult = {
  resolvedPairColor: PairColor
  channelId: string
  requestedWorkflowId: string | null
  resolvedWorkflowId: string | null
  hasLoadedWorkflows: boolean
  loadError: 'unableToLoadWorkflows' | null
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

  const requestedWorkflowId = useMemo(
    () =>
      resolveEntityId('workflowId', {
        params: shouldUsePairWorkflowContext ? null : params,
        pairContext: shouldUsePairWorkflowContext ? pairContext : null,
      }),
    [pairContext, params, shouldUsePairWorkflowContext]
  )

  const rawActiveWorkflowIdForChannel = useWorkflowRegistry((state) =>
    state.getActiveWorkflowId(channelId)
  )
  const isChannelHydrating = useWorkflowRegistry((state) => state.isChannelHydrating(channelId))

  const workflowIds = useMemo(() => members.map((member) => member.entityId), [members])
  const hasLoadedWorkflows = !workspaceId || Boolean(listError) || !isListLoading
  const canResolveWorkflowIds = Boolean(workspaceId) && !listError && !isListLoading

  const resolvedWorkflowId = useMemo(() => {
    if (!canResolveWorkflowIds) return null

    const canFollowChannel = !shouldUsePairWorkflowContext && !requestedWorkflowId

    return resolveEntityIdFromList({
      requestedEntityId: requestedWorkflowId,
      fallbackEntityId: canFollowChannel ? rawActiveWorkflowIdForChannel : null,
      entityIds: workflowIds,
      useDefaultEntity: !shouldUsePairWorkflowContext,
    })
  }, [
    workflowIds,
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

  const loadError: 'unableToLoadWorkflows' | null = listError ? 'unableToLoadWorkflows' : null

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
