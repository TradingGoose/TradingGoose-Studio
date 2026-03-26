'use client'

import { useEffect, useMemo, useState } from 'react'
import { shallow } from 'zustand/shallow'
import {
  type PairColorContext,
  usePairColorStore,
  useSetPairColorContext,
} from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'

type UseWorkflowWidgetStateOptions = Pick<
  WidgetComponentProps,
  'params' | 'pairColor' | 'panelId' | 'widget' | 'onWidgetParamsChange'
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
  loadError: string | null
  isLoading: boolean
  workflowIds: string[]
  activeWorkflowIdForChannel: string | null
}

const DEFAULT_LOAD_ERROR_MESSAGE = 'Unable to load workflows'
const MAX_METADATA_LOAD_ATTEMPTS = 2
const EMPTY_PAIR_CONTEXT: Readonly<PairColorContext> = Object.freeze({})

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
  const setPairContext = useSetPairColorContext()
  const { workflows, loadWorkflows, setActiveWorkflow } = useWorkflowRegistry(
    (state) => ({
      workflows: state.workflows,
      loadWorkflows: state.loadWorkflows,
      setActiveWorkflow: state.setActiveWorkflow,
    }),
    shallow
  )

  const workflowMap = workflows ?? {}
  const [hasRequestedLoad, setHasRequestedLoad] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempts, setLoadAttempts] = useState(0)

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
  const hydration = useWorkflowRegistry((state) => state.getHydration(channelId))
  const isChannelHydrating = useWorkflowRegistry((state) => state.isChannelHydrating(channelId))

  const workspaceWorkflowMap = useMemo(() => {
    if (!workspaceId) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(workflowMap).filter(([, workflow]) => workflow?.workspaceId === workspaceId)
    )
  }, [workflowMap, workspaceId])

  const workflowIds = useMemo(() => Object.keys(workspaceWorkflowMap), [workspaceWorkflowMap])

  const workspaceHasWorkflows = workflowIds.length > 0

  useEffect(() => {
    setLoadError(null)
    setHasRequestedLoad(false)
    setLoadAttempts(0)
  }, [workspaceId, channelId])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    if (workspaceHasWorkflows) {
      return
    }

    if (hydration.phase === 'metadata-loading' || hydration.phase === 'state-loading') {
      return
    }

    if (
      hydration.phase !== 'idle' &&
      hydration.phase !== 'error' &&
      hydration.phase !== 'metadata-ready'
    ) {
      return
    }

    if (loadAttempts >= MAX_METADATA_LOAD_ATTEMPTS) {
      return
    }

    let cancelled = false
    setHasRequestedLoad(true)
    setLoadAttempts((previous) => previous + 1)
    loadWorkflows({ workspaceId, channelId }).catch((error) => {
      if (cancelled) {
        return
      }

      console.error(`Failed to load workflows for ${loggerScope}`, error)
      setLoadError(
        error instanceof Error &&
          (error.message === 'Unauthorized' || error.message === 'Forbidden')
          ? 'Authentication required to load workflows'
          : DEFAULT_LOAD_ERROR_MESSAGE
      )
    })

    return () => {
      cancelled = true
    }
  }, [
    workspaceId,
    workspaceHasWorkflows,
    hydration.phase,
    loadAttempts,
    loadWorkflows,
    loggerScope,
    channelId,
  ])

  const resolvedWorkflowId = useMemo(() => {
    if (workflowIds.length === 0) {
      return null
    }

    const pairWorkflowId =
      shouldUsePairWorkflowContext &&
      pairContext.workflowId &&
      workspaceWorkflowMap[pairContext.workflowId]
        ? pairContext.workflowId
        : null

    if (pairWorkflowId) {
      return pairWorkflowId
    }

    const channelWorkflowId =
      rawActiveWorkflowIdForChannel && workspaceWorkflowMap[rawActiveWorkflowIdForChannel]
        ? rawActiveWorkflowIdForChannel
        : null

    if (channelWorkflowId) {
      return channelWorkflowId
    }

    if (requestedWorkflowId && workspaceWorkflowMap[requestedWorkflowId]) {
      return requestedWorkflowId
    }

    return workflowIds[0]
  }, [
    workflowIds,
    pairContext.workflowId,
    workspaceWorkflowMap,
    rawActiveWorkflowIdForChannel,
    requestedWorkflowId,
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

  const hasLoadedWorkflows = useMemo(() => {
    if (!workspaceId) {
      return true
    }
    if (workspaceHasWorkflows || Boolean(loadError)) {
      return true
    }
    return hasRequestedLoad && hydration.phase !== 'metadata-loading'
  }, [workspaceId, workspaceHasWorkflows, loadError, hasRequestedLoad, hydration.phase])

  useEffect(() => {
    if (!shouldUsePairWorkflowContext || !resolvedWorkflowId) {
      return
    }

    if (pairContext.workflowId === resolvedWorkflowId) {
      return
    }

    setPairContext(resolvedPairColor, {
      workflowId: resolvedWorkflowId,
      listing: pairContext.listing,
      channelId,
    })
  }, [
    shouldUsePairWorkflowContext,
    resolvedWorkflowId,
    pairContext.workflowId,
    pairContext.listing,
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

    const nextParams = { ...(params ?? {}), workflowId: resolvedWorkflowId }
    onWidgetParamsChange(nextParams)
  }, [resolvedPairColor, resolvedWorkflowId, requestedWorkflowId, onWidgetParamsChange, params])

  return {
    resolvedPairColor,
    channelId,
    requestedWorkflowId,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading: isChannelHydrating,
    workflowIds,
    activeWorkflowIdForChannel: activeWorkflowIdForChannel ?? null,
  }
}
