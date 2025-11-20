'use client'

import { useEffect, useMemo, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { WidgetComponentProps } from '@/widgets/types'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { hasWorkflowsInitiallyLoaded, useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import type { PairColor } from '@/widgets/pair-colors'

type UseWorkflowWidgetStateOptions = Pick<
  WidgetComponentProps,
  'params' | 'pairColor' | 'panelId' | 'widget' | 'onWidgetParamsChange'
> & {
  workspaceId?: string
  fallbackWidgetKey: string
  loggerScope?: string
  activateWorkflow?: boolean
}

type UseWorkflowWidgetStateResult = {
  resolvedPairColor: PairColor
  channelId: string
  requestedWorkflowId: string | null
  resolvedWorkflowId: string | null
  hasLoadedWorkflows: boolean
  loadError: string | null
  isLoading: boolean
  workflowIds: string[]
  activeWorkflowIdForChannel: string | null
}

const DEFAULT_LOAD_ERROR_MESSAGE = 'Unable to load workflows'

export const useWorkflowWidgetState = ({
  workspaceId,
  pairColor,
  widget,
  panelId,
  params,
  onWidgetParamsChange,
  fallbackWidgetKey,
  loggerScope = 'workflow widget',
  activateWorkflow = true,
}: UseWorkflowWidgetStateOptions): UseWorkflowWidgetStateResult => {
  const { resolvedPairColor, channelId } = resolveWidgetChannel({
    pairColor,
    widget,
    panelId,
    fallbackWidgetKey,
  })
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const { workflows, isLoading, loadWorkflows, setActiveWorkflow } = useWorkflowRegistry(
    (state) => ({
      workflows: state.workflows,
      isLoading: state.isLoading,
      loadWorkflows: state.loadWorkflows,
      setActiveWorkflow: state.setActiveWorkflow,
    }),
    shallow
  )

  const workflowMap = workflows ?? {}
  const [hasLoadedWorkflows, setHasLoadedWorkflows] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const requestedWorkflowId = useMemo(() => {
    if (resolvedPairColor !== 'gray' || !params || typeof params !== 'object') {
      return null
    }

    return 'workflowId' in params && params.workflowId ? String(params.workflowId) : null
  }, [resolvedPairColor, params])

  const rawActiveWorkflowIdForChannel = useWorkflowRegistry((state) =>
    typeof state.getActiveWorkflowId === 'function'
      ? state.getActiveWorkflowId(channelId)
      : state.activeWorkflowId
  )

  const workspaceHasWorkflows = useMemo(() => {
    if (!workspaceId) {
      return false
    }
    return Object.values(workflowMap).some((workflow) => workflow?.workspaceId === workspaceId)
  }, [workflowMap, workspaceId])

  useEffect(() => {
    setLoadError(null)

    if (!workspaceId) {
      setHasLoadedWorkflows(true)
      return
    }

    if (workspaceHasWorkflows || hasWorkflowsInitiallyLoaded()) {
      setHasLoadedWorkflows(true)
      return
    }

    let cancelled = false
    setHasLoadedWorkflows(false)

    loadWorkflows(workspaceId)
      .catch((error) => {
        if (!cancelled) {
          console.error(`Failed to load workflows for ${loggerScope}`, error)
          setLoadError(DEFAULT_LOAD_ERROR_MESSAGE)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHasLoadedWorkflows(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, workspaceHasWorkflows, loadWorkflows, loggerScope])

  const workflowIds = useMemo(() => Object.keys(workflowMap), [workflowMap])

  const resolvedWorkflowId = useMemo(() => {
    if (!hasLoadedWorkflows || workflowIds.length === 0) {
      return null
    }

    const pairWorkflowId =
      resolvedPairColor !== 'gray' &&
      pairContext.workflowId &&
      workflowMap[pairContext.workflowId]
        ? pairContext.workflowId
        : null

    if (pairWorkflowId) {
      return pairWorkflowId
    }

    if (requestedWorkflowId && workflowMap[requestedWorkflowId]) {
      return requestedWorkflowId
    }

    return workflowIds[0]
  }, [
    hasLoadedWorkflows,
    workflowIds,
    pairContext.workflowId,
    workflowMap,
    requestedWorkflowId,
    resolvedPairColor,
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

    let cancelled = false

    setActiveWorkflow({ workflowId: resolvedWorkflowId, channelId })
      .catch((error) => {
        if (!cancelled) {
          console.error(`Failed to activate workflow for ${loggerScope}`, error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    activateWorkflow,
    resolvedWorkflowId,
    activeWorkflowIdForChannel,
    setActiveWorkflow,
    channelId,
    loggerScope,
  ])

  useEffect(() => {
    if (resolvedPairColor === 'gray' || !resolvedWorkflowId) {
      return
    }

    if (pairContext.workflowId === resolvedWorkflowId) {
      return
    }

    setPairContext(resolvedPairColor, {
      workflowId: resolvedWorkflowId,
      ticker: pairContext.ticker,
      channelId,
    })
  }, [
    resolvedPairColor,
    resolvedWorkflowId,
    pairContext.workflowId,
    pairContext.ticker,
    setPairContext,
    channelId,
  ])

  useEffect(() => {
    if (resolvedPairColor !== 'gray' || !resolvedWorkflowId || !onWidgetParamsChange) {
      return
    }

    if (requestedWorkflowId === resolvedWorkflowId) {
      return
    }

    onWidgetParamsChange({ workflowId: resolvedWorkflowId })
  }, [resolvedPairColor, resolvedWorkflowId, requestedWorkflowId, onWidgetParamsChange])

  return {
    resolvedPairColor,
    channelId,
    requestedWorkflowId,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading,
    workflowIds,
    activeWorkflowIdForChannel: activeWorkflowIdForChannel ?? null,
  }
}
