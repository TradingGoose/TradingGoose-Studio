'use client'

import { useMemo } from 'react'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import type { WidgetComponentProps } from '@/widgets/types'
import { resolveEntityId, resolveEntityIdFromList } from '@/widgets/widget-contracts'

type UseWorkflowWidgetStateOptions = Pick<WidgetComponentProps, 'params'> & {
  workspaceId?: string
}

type UseWorkflowWidgetStateResult = {
  resolvedWorkflowId: string | null
  hasLoadedWorkflows: boolean
  loadError: 'unableToLoadWorkflows' | null
  isLoading: boolean
  workflowIds: string[]
}

export const useWorkflowWidgetState = ({
  workspaceId,
  params,
}: UseWorkflowWidgetStateOptions): UseWorkflowWidgetStateResult => {
  const {
    members,
    isLoading: isListLoading,
    error: listError,
  } = useEntityList('workflow', workspaceId)

  const storedWorkflowId = resolveEntityId('workflowId', {
    params,
  })

  const workflowIds = useMemo(
    () =>
      [...members]
        .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
        .map((member) => member.entityId),
    [members]
  )
  const hasWorkflowMembers = workflowIds.length > 0
  const hasLoadedWorkflows =
    !workspaceId || hasWorkflowMembers || Boolean(listError) || !isListLoading

  const resolvedWorkflowId = useMemo(() => {
    if (!workspaceId || (!hasWorkflowMembers && (listError || isListLoading))) return null

    return resolveEntityIdFromList({
      requestedEntityId: storedWorkflowId,
      entityIds: workflowIds,
      useDefaultEntity: false,
    })
  }, [workflowIds, storedWorkflowId, workspaceId, hasWorkflowMembers, listError, isListLoading])

  const loadError: 'unableToLoadWorkflows' | null = listError ? 'unableToLoadWorkflows' : null

  return {
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading: isListLoading && !hasWorkflowMembers,
    workflowIds,
  }
}
