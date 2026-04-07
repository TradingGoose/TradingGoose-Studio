'use client'

import { useEffect, useMemo, useState } from 'react'
import { shallow } from 'zustand/shallow'
import {
  type PairColorContext,
  usePairColorStore,
  useSetPairColorContext,
} from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WORKSPACE_BOOTSTRAP_CHANNEL } from '@/stores/workflows/registry/types'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import type { ReviewTargetEventFields } from '@/widgets/events'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

/**
 * Review-target fields that can be supplied via widget params to
 * put the copilot into entity-review mode instead of workflow mode.
 *
 * Re-exported from {@link ReviewTargetEventFields} with added `| null`
 * to accommodate normalised values.
 */
export type ReviewTargetParams = {
  [K in keyof ReviewTargetEventFields]?: ReviewTargetEventFields[K] | null
}

type UseWorkflowWidgetStateOptions = Pick<
  WidgetComponentProps,
  'params' | 'pairColor' | 'panelId' | 'widget' | 'onWidgetParamsChange'
> & {
  workspaceId?: string
  fallbackWidgetKey: string
  loggerScope?: string
  activateWorkflow?: boolean
  usePairWorkflowContext?: boolean
} & ReviewTargetParams

export type ReviewTargetMode =
  | { kind: 'workflow' }
  | {
      kind: 'entity'
      entityKind: ReviewEntityKind
      entityId: string | null
      reviewSessionId: string | null
      reviewDraftSessionId: string | null
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
  /** Indicates whether the widget is in workflow mode or entity-review mode. */
  reviewTargetMode: ReviewTargetMode
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
  reviewSessionId: reviewSessionIdOpt,
  reviewEntityKind: reviewEntityKindOpt,
  reviewEntityId: reviewEntityIdOpt,
  reviewDraftSessionId: reviewDraftSessionIdOpt,
}: UseWorkflowWidgetStateOptions): UseWorkflowWidgetStateResult => {
  const { resolvedPairColor, channelId } = resolveWidgetChannel({
    pairColor,
    widget,
    panelId,
    fallbackWidgetKey,
  })
  // Metadata is workspace-scoped, not pair-scoped. Loading it through the shared bootstrap channel
  // avoids pair-context resets discarding in-flight metadata requests before a pair has an active workflow.
  const metadataChannelId = WORKSPACE_BOOTSTRAP_CHANNEL
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
  const metadataHydration = useWorkflowRegistry((state) => state.getHydration(metadataChannelId))
  const isChannelHydrating = useWorkflowRegistry((state) => state.isChannelHydrating(channelId))
  const isMetadataChannelHydrating = useWorkflowRegistry((state) =>
    state.isChannelHydrating(metadataChannelId)
  )

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
  }, [workspaceId, metadataChannelId])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    if (workspaceHasWorkflows) {
      return
    }

    if (
      metadataHydration.phase === 'metadata-loading' ||
      metadataHydration.phase === 'state-loading'
    ) {
      return
    }

    if (
      metadataHydration.phase !== 'idle' &&
      metadataHydration.phase !== 'error' &&
      metadataHydration.phase !== 'metadata-ready'
    ) {
      return
    }

    if (loadAttempts >= MAX_METADATA_LOAD_ATTEMPTS) {
      return
    }

    let cancelled = false
    setHasRequestedLoad(true)
    setLoadAttempts((previous) => previous + 1)
    loadWorkflows({ workspaceId, channelId: metadataChannelId }).catch((error) => {
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
    metadataHydration.phase,
    loadAttempts,
    loadWorkflows,
    loggerScope,
    metadataChannelId,
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
    return hasRequestedLoad && metadataHydration.phase !== 'metadata-loading'
  }, [workspaceId, workspaceHasWorkflows, loadError, hasRequestedLoad, metadataHydration.phase])

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

  // Build the review-target mode descriptor.
  // Entity mode activates when a non-workflow entityKind is present AND either
  // an entityId (saved entity) or a draftSessionId (unsaved draft) exists.
  const reviewTargetMode: ReviewTargetMode = useMemo(() => {
    if (
      reviewEntityKindOpt &&
      reviewEntityKindOpt !== 'workflow' &&
      (reviewEntityIdOpt || reviewDraftSessionIdOpt)
    ) {
      return {
        kind: 'entity',
        entityKind: reviewEntityKindOpt,
        entityId: reviewEntityIdOpt ?? null,
        reviewSessionId: reviewSessionIdOpt ?? null,
        reviewDraftSessionId: reviewDraftSessionIdOpt ?? null,
      }
    }

    return { kind: 'workflow' }
  }, [
    reviewEntityKindOpt,
    reviewEntityIdOpt,
    reviewSessionIdOpt,
    reviewDraftSessionIdOpt,
  ])

  return {
    resolvedPairColor,
    channelId,
    requestedWorkflowId,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading: isMetadataChannelHydrating || isChannelHydrating,
    workflowIds,
    activeWorkflowIdForChannel: activeWorkflowIdForChannel ?? null,
    reviewTargetMode,
  }
}
