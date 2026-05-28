'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { type MonitorCopy, useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import { fetchOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import {
  getMarketMonitorProviderParamDefinitions,
  getMarketProviderIntervals,
  getMarketProviderOptions,
  type MarketProviderOption,
} from '@/providers/market/providers'
import {
  getTradingWidgetProviderAvailabilityIds,
  getTradingWidgetProviderOptions,
} from '@/widgets/utils/trading-widget-providers'
import type {
  IndicatorOption,
  MonitorReferenceData,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from '../shared/types'
import { loadIndicatorOptions, loadWorkflowOptions, loadWorkflowTargetOptions } from './api'

const EMPTY_REFERENCE_DATA: MonitorReferenceData = {
  workflowTargets: [],
  workflowTargetByKey: {},
  workflowOptions: [],
  indicatorWorkflowTargets: [],
  portfolioWorkflowTargets: [],
  indicatorOptions: [],
  indicatorById: {},
  marketProviders: [],
  marketProviderById: {},
  providerIntervalsByProviderId: {},
  providerParamDefinitionsByProviderId: {},
  tradingProviders: [],
  tradingProviderById: {},
  defaultMarketProviderId: '',
  defaultPortfolioProviderId: '',
  defaultDraftInterval: '1m',
  createDisabledReason: null,
  isLoading: true,
  warning: null,
}

const buildReferenceData = ({
  copy,
  workflowTargets,
  workflowOptions,
  indicatorOptions,
  tradingProviderAvailability,
  isLoading,
  warning,
}: {
  copy: MonitorCopy
  workflowTargets: WorkflowTargetOption[]
  workflowOptions: WorkflowPickerOption[]
  indicatorOptions: IndicatorOption[]
  tradingProviderAvailability: Record<string, boolean>
  isLoading: boolean
  warning: string | null
}): MonitorReferenceData => {
  const marketProviders: MarketProviderOption[] = getMarketProviderOptions()
  const tradingProviders = getTradingWidgetProviderOptions(
    'portfolioDetail',
    tradingProviderAvailability
  )
  const workflowTargetByKey = Object.fromEntries(
    workflowTargets.map((target) => [`${target.workflowId}:${target.blockId}`, target])
  )
  const indicatorWorkflowTargets = workflowTargets.filter(
    (target) => target.source === INDICATOR_MONITOR_PROVIDER
  )
  const portfolioWorkflowTargets = workflowTargets.filter(
    (target) => target.source === PORTFOLIO_MONITOR_PROVIDER
  )
  const indicatorById = Object.fromEntries(
    indicatorOptions.map((indicator) => [indicator.id, indicator])
  )
  const marketProviderById = Object.fromEntries(
    marketProviders.map((provider) => [provider.id, provider])
  )
  const tradingProviderById = Object.fromEntries(
    tradingProviders.map((provider) => [provider.id, provider])
  )
  const providerIntervalsByProviderId = Object.fromEntries(
    marketProviders.map((provider) => [provider.id, getMarketProviderIntervals(provider.id)])
  )
  const providerParamDefinitionsByProviderId = Object.fromEntries(
    marketProviders.map((provider) => [
      provider.id,
      getMarketMonitorProviderParamDefinitions(provider.id),
    ])
  )
  const defaultMarketProviderId = marketProviders[0]?.id ?? ''
  const defaultPortfolioProviderId = tradingProviders[0]?.id ?? ''
  const defaultDraftInterval =
    providerIntervalsByProviderId[defaultMarketProviderId]?.[0] ?? '1m'
  const canCreateIndicatorMonitor =
    indicatorWorkflowTargets.length > 0 && indicatorOptions.length > 0
  const canCreatePortfolioMonitor =
    portfolioWorkflowTargets.length > 0 && tradingProviders.length > 0
  const createDisabledReason = isLoading
    ? copy.loadingRequirements
    : canCreateIndicatorMonitor || canCreatePortfolioMonitor
      ? null
      : portfolioWorkflowTargets.length > 0 && tradingProviders.length === 0
        ? 'No enabled trading provider is available for portfolio monitors.'
        : copy.referenceData.createDisabledReason

  return {
    workflowTargets,
    workflowTargetByKey,
    workflowOptions,
    indicatorWorkflowTargets,
    portfolioWorkflowTargets,
    indicatorOptions,
    indicatorById,
    marketProviders,
    marketProviderById,
    providerIntervalsByProviderId,
    providerParamDefinitionsByProviderId,
    tradingProviders,
    tradingProviderById,
    defaultMarketProviderId,
    defaultPortfolioProviderId,
    defaultDraftInterval,
    createDisabledReason,
    isLoading,
    warning,
  }
}

export function useMonitorReferenceData(workspaceId: string): MonitorReferenceData {
  const { copy } = useMonitorCopy()
  const [workflowTargets, setWorkflowTargets] = useState<WorkflowTargetOption[]>([])
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowPickerOption[]>([])
  const [indicatorOptions, setIndicatorOptions] = useState<IndicatorOption[]>([])
  const [tradingProviderAvailability, setTradingProviderAvailability] = useState<
    Record<string, boolean>
  >({})
  const [isLoading, setIsLoading] = useState(true)
  const [warning, setWarning] = useState<string | null>(null)
  const tradingProviderAvailabilityIds = useMemo(
    () => getTradingWidgetProviderAvailabilityIds('portfolioDetail'),
    []
  )

  const loadReferenceData = useCallback(async () => {
    setIsLoading(true)
    setWarning(null)

    const [indicatorResult, targetsResult, workflowsResult, tradingProviderAvailabilityResult] =
      await Promise.allSettled([
        loadIndicatorOptions(workspaceId),
        loadWorkflowTargetOptions(workspaceId),
        loadWorkflowOptions(workspaceId),
        fetchOAuthProviderAvailability(tradingProviderAvailabilityIds),
      ])

    let nextWarning: string | null = null

    if (indicatorResult.status === 'fulfilled') {
      setIndicatorOptions(indicatorResult.value)
    } else {
      setIndicatorOptions([])
      nextWarning = copy.referenceData.indicatorOptionsUnavailable
    }

    if (targetsResult.status === 'fulfilled') {
      setWorkflowTargets(targetsResult.value)
    } else {
      setWorkflowTargets([])
      nextWarning = nextWarning ?? copy.referenceData.workflowTargetsUnavailable
    }

    if (workflowsResult.status === 'fulfilled') {
      setWorkflowOptions(workflowsResult.value)
    } else {
      setWorkflowOptions([])
      nextWarning = nextWarning ?? copy.referenceData.workflowOptionsUnavailable
    }

    if (tradingProviderAvailabilityResult.status === 'fulfilled') {
      setTradingProviderAvailability(tradingProviderAvailabilityResult.value)
    } else {
      setTradingProviderAvailability({})
      nextWarning = nextWarning ?? 'Trading provider availability is unavailable right now.'
    }

    setWarning(nextWarning)
    setIsLoading(false)
  }, [
    copy.referenceData.indicatorOptionsUnavailable,
    copy.referenceData.workflowOptionsUnavailable,
    copy.referenceData.workflowTargetsUnavailable,
    tradingProviderAvailabilityIds,
    workspaceId,
  ])

  useEffect(() => {
    if (!workspaceId) {
      setWorkflowTargets([])
      setWorkflowOptions([])
      setIndicatorOptions([])
      setTradingProviderAvailability({})
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
            copy,
            workflowTargets,
            workflowOptions,
            indicatorOptions,
            tradingProviderAvailability,
            isLoading,
            warning,
          })
        : { ...EMPTY_REFERENCE_DATA, isLoading: false },
    [
      copy,
      indicatorOptions,
      isLoading,
      tradingProviderAvailability,
      warning,
      workflowOptions,
      workflowTargets,
      workspaceId,
    ]
  )
}
