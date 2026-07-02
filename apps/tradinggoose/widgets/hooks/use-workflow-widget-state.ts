'use client'

import { useMemo } from 'react'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
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
  usePairWorkflowContext?: boolean
}

type UseWorkflowWidgetStateResult = {
  resolvedPairColor: PairColor
  channelId: string
  resolvedWorkflowId: string | null
  hasLoadedWorkflows: boolean
  loadError: 'unableToLoadWorkflows' | null
  isLoading: boolean
  workflowIds: string[]
}

const EMPTY_PAIR_CONTEXT: Readonly<PairColorContext> = Object.freeze({})

export const useWorkflowWidgetState = ({
  workspaceId,
  pairColor,
  widget,
  panelId,
  params,
  fallbackWidgetKey,
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

  const storedWorkflowId = resolveEntityId('workflowId', {
    params: shouldUsePairWorkflowContext ? null : params,
    pairContext: shouldUsePairWorkflowContext ? pairContext : null,
  })

  const workflowIds = useMemo(
    () =>
      [...members]
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .map((member) => member.entityId),
    [members]
  )
  const hasLoadedWorkflows = !workspaceId || Boolean(listError) || !isListLoading
  const canResolveWorkflowIds = Boolean(workspaceId) && !listError && !isListLoading

  const resolvedWorkflowId = useMemo(() => {
    if (!canResolveWorkflowIds) return null

    // Unstored gray widgets intentionally derive the current newest workflow.
    return resolveEntityIdFromList({
      requestedEntityId: storedWorkflowId,
      entityIds: workflowIds,
      useDefaultEntity: !shouldUsePairWorkflowContext,
    })
  }, [workflowIds, storedWorkflowId, canResolveWorkflowIds, shouldUsePairWorkflowContext])

  const loadError: 'unableToLoadWorkflows' | null = listError ? 'unableToLoadWorkflows' : null

  return {
    resolvedPairColor,
    channelId,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading: isListLoading,
    workflowIds,
  }
}
