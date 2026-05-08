'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getMarketLiveCapabilities,
  getMarketProviderOptionsByKind,
  getMarketProviderParamDefinitions,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import type {
  IndicatorOption,
  MonitorReferenceData,
  StreamingProviderOption,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from '../shared/types'
import { loadIndicatorOptions, loadWorkflowOptions, loadWorkflowTargetOptions } from './api'

const EMPTY_REFERENCE_DATA: MonitorReferenceData = {
  workflowTargets: [],
  workflowTargetByKey: {},
  workflowOptions: [],
  indicatorOptions: [],
  indicatorById: {},
  streamingProviders: [],
  providerById: {},
  providerIntervalsByProviderId: {},
  providerParamDefinitionsByProviderId: {},
  defaultDraftProviderId: 'alpaca',
  defaultDraftInterval: '1m',
  createDisabledReason:
    'No deployed workflow with indicator trigger is available, or no trigger-capable indicator exists.',
  isLoading: true,
  warning: null,
}

const buildReferenceData = ({
  workflowTargets,
  workflowOptions,
  indicatorOptions,
  isLoading,
  warning,
}: {
  workflowTargets: WorkflowTargetOption[]
  workflowOptions: WorkflowPickerOption[]
  indicatorOptions: IndicatorOption[]
  isLoading: boolean
  warning: string | null
}): MonitorReferenceData => {
  const streamingProviders: StreamingProviderOption[] = getMarketProviderOptionsByKind('live').filter(
    (option) => Boolean(getMarketLiveCapabilities(option.id)?.supportsStreaming)
  )
  const workflowTargetByKey = Object.fromEntries(
    workflowTargets.map((target) => [`${target.workflowId}:${target.blockId}`, target])
  )
  const indicatorById = Object.fromEntries(
    indicatorOptions.map((indicator) => [indicator.id, indicator])
  )
  const providerById = Object.fromEntries(streamingProviders.map((provider) => [provider.id, provider]))
  const providerIntervalsByProviderId = Object.fromEntries(
    streamingProviders.map((provider) => [
      provider.id,
      getMarketSeriesCapabilities(provider.id)?.intervals ?? [],
    ])
  )
  const providerParamDefinitionsByProviderId = Object.fromEntries(
    streamingProviders.map((provider) => [
      provider.id,
      getMarketProviderParamDefinitions(provider.id, 'live'),
    ])
  )
  const defaultDraftProviderId = streamingProviders[0]?.id ?? 'alpaca'
  const defaultDraftInterval = providerIntervalsByProviderId[defaultDraftProviderId]?.[0] ?? '1m'
  const createDisabledReason = isLoading
    ? 'Loading monitor requirements...'
    : workflowTargets.length > 0 && indicatorOptions.length > 0
      ? null
      : 'No deployed workflow with indicator trigger is available, or no trigger-capable indicator exists.'

  return {
    workflowTargets,
    workflowTargetByKey,
    workflowOptions,
    indicatorOptions,
    indicatorById,
    streamingProviders,
    providerById,
    providerIntervalsByProviderId,
    providerParamDefinitionsByProviderId,
    defaultDraftProviderId,
    defaultDraftInterval,
    createDisabledReason,
    isLoading,
    warning,
  }
}

export function useMonitorReferenceData(workspaceId: string): MonitorReferenceData {
  const [workflowTargets, setWorkflowTargets] = useState<WorkflowTargetOption[]>([])
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowPickerOption[]>([])
  const [indicatorOptions, setIndicatorOptions] = useState<IndicatorOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)

  const loadReferenceData = useCallback(async () => {
    setIsLoading(true)
    setWarning(null)

    const [indicatorResult, targetsResult, workflowsResult] = await Promise.allSettled([
      loadIndicatorOptions(workspaceId),
      loadWorkflowTargetOptions(workspaceId),
      loadWorkflowOptions(workspaceId),
    ])

    let nextWarning: string | null = null

    if (indicatorResult.status === 'fulfilled') {
      setIndicatorOptions(indicatorResult.value)
    } else {
      setIndicatorOptions([])
      nextWarning = 'Indicator options are unavailable right now.'
    }

    if (targetsResult.status === 'fulfilled') {
      setWorkflowTargets(targetsResult.value)
    } else {
      setWorkflowTargets([])
      nextWarning = nextWarning ?? 'Workflow targets are unavailable right now.'
    }

    if (workflowsResult.status === 'fulfilled') {
      setWorkflowOptions(workflowsResult.value)
    } else {
      setWorkflowOptions([])
      nextWarning = nextWarning ?? 'Workflow options are unavailable right now.'
    }

    setWarning(nextWarning)
    setIsLoading(false)
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      setWorkflowTargets([])
      setWorkflowOptions([])
      setIndicatorOptions([])
      setIsLoading(false)
      setWarning(null)
      return
    }

    void loadReferenceData()
  }, [loadReferenceData, workspaceId])

  return useMemo(
    () =>
      workspaceId
        ? buildReferenceData({
            workflowTargets,
            workflowOptions,
            indicatorOptions,
            isLoading,
            warning,
          })
        : { ...EMPTY_REFERENCE_DATA, isLoading: false },
    [indicatorOptions, isLoading, warning, workflowOptions, workflowTargets, workspaceId]
  )
}
