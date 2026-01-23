'use client'

import { type MutableRefObject, useEffect, useRef, useState } from 'react'
import { type Chart, type KLineData, registerIndicator } from 'klinecharts'
import {
  buildIndicatorTemplate,
  type IndicatorSignal,
  isIndicatorDraft,
} from '@/lib/indicators/custom/compile'
import { DEFAULT_INDICATOR_MAP } from '@/lib/indicators/default'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'
import { areStringArraysEqual } from '@/widgets/widgets/data_chart/utils'
import type { DataChartIndicatorRef } from '@/widgets/widgets/data_chart/types'

type UseIndicatorSyncArgs = {
  chartRef: MutableRefObject<Chart | null>
  indicatorInstanceMapRef: MutableRefObject<Record<string, string>>
  workspaceId: string | null
  indicatorRefs: DataChartIndicatorRef[]
  indicators: CustomIndicatorDefinition[]
  providerId?: string | null
  dataVersion?: number
}

export const useIndicatorSync = ({
  chartRef,
  indicatorInstanceMapRef,
  workspaceId,
  indicatorRefs,
  indicators,
  providerId,
  dataVersion,
}: UseIndicatorSyncArgs) => {
  const [chartWarnings, setChartWarnings] = useState<string[]>([])
  const indicatorVersionRef = useRef<Record<string, string>>({})
  const signalOverlayIdsRef = useRef<Record<string, string[]>>({})
  const registeredDefaultNamesRef = useRef<Set<string>>(new Set())
  const pendingSignalsRef = useRef<
    Record<string, { signals: IndicatorSignal[]; dataList: KLineData[] }>
  >({})
  const signalFlushHandleRef = useRef<number | null>(null)

  useEffect(() => {
    setChartWarnings([])
  }, [providerId])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const overlayIdsMap = signalOverlayIdsRef.current
    Object.keys(overlayIdsMap).forEach((indicatorId) => {
      overlayIdsMap[indicatorId].forEach((overlayId) => {
        chart.removeOverlay({ id: overlayId })
      })
    })
    signalOverlayIdsRef.current = {}
    pendingSignalsRef.current = {}
  }, [chartRef, providerId])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!workspaceId) return

    const warnings: string[] = []
    const compiledIndicatorIds = new Set<string>()
    const paneTargets = new Map<
      string,
      { isStack: boolean; paneOptions?: { id: string } }
    >()
    const indicatorMap = new Map(indicators.map((indicator) => [indicator.id, indicator]))
    const normalizedRefs = Array.isArray(indicatorRefs) ? indicatorRefs : []
    const customIds = normalizedRefs
      .filter((ref) => ref?.isCustom === true && typeof ref.id === 'string')
      .map((ref) => ref.id)
    const defaultIds = normalizedRefs
      .filter((ref) => ref?.isCustom !== true && typeof ref.id === 'string')
      .map((ref) => ref.id)
    const selectedIndicators = customIds
      .map((id) => indicatorMap.get(id))
      .filter((indicator): indicator is CustomIndicatorDefinition => Boolean(indicator))
    const selectedDefaultIndicators = defaultIds.map((id) => ({
      id,
      template: DEFAULT_INDICATOR_MAP.get(id) ?? null,
    }))
    const invalidIndicatorIds = new Set<string>()
    const missingIds = customIds.filter((id) => !indicatorMap.has(id))
    missingIds.forEach((id) => {
      warnings.push(`${id} is missing.`)
      delete indicatorVersionRef.current[id]
    })

    const missingDefaultIds = defaultIds.filter((id) => !DEFAULT_INDICATOR_MAP.has(id))
    missingDefaultIds.forEach((id) => {
      warnings.push(`${id} is missing.`)
      invalidIndicatorIds.add(id)
      delete indicatorVersionRef.current[id]
    })
    const enqueueSignals = ({
      indicatorId,
      signals,
      dataList,
    }: {
      indicatorId: string
      signals: IndicatorSignal[]
      dataList: KLineData[]
    }) => {
      pendingSignalsRef.current[indicatorId] = { signals, dataList }
      if (signalFlushHandleRef.current) return
      const schedule =
        typeof window !== 'undefined' && window.requestAnimationFrame
          ? window.requestAnimationFrame.bind(window)
          : (cb: FrameRequestCallback) => setTimeout(cb, 16)
      signalFlushHandleRef.current = schedule(() => {
        signalFlushHandleRef.current = null
        const chart = chartRef.current
        if (!chart) return
        const pending = { ...pendingSignalsRef.current }
        pendingSignalsRef.current = {}

        Object.entries(pending).forEach(([pendingIndicatorId, payload]) => {
          const existing = signalOverlayIdsRef.current[pendingIndicatorId] ?? []
          existing.forEach((overlayId) => chart.removeOverlay({ id: overlayId }))

          const overlayIds: string[] = []
          if (!payload.signals.length) {
            signalOverlayIdsRef.current[pendingIndicatorId] = []
            return
          }

          const dataList = payload.dataList
          const dataLength = dataList.length

          payload.signals.forEach((signal) => {
            const isBuy = signal.type === 'buy'
            const color = signal.color || (isBuy ? '#00E676' : '#FF5252')
            const textFallback = signal.text || (isBuy ? 'B' : 'S')
            const data = signal.data ?? []

            for (let i = 0; i < Math.min(dataLength, data.length); i += 1) {
              const value = data[i]
              if (typeof value !== 'number' || !Number.isFinite(value)) continue
              const candle = dataList[i]
              if (!candle) continue
              const timestamp = candle.timestamp
              if (!Number.isFinite(timestamp)) continue
              const low = Number.isFinite(candle.low) ? candle.low : candle.close
              const high = Number.isFinite(candle.high) ? candle.high : candle.close
              const anchorPrice = isBuy ? low : high
              const textDataValue = signal.textData ? signal.textData[i] : undefined
              const textData =
                typeof textDataValue === 'string' ? textDataValue : textFallback

              const overlayId = chart.createOverlay({
                name: 'signalTag',
                paneId: 'candle_pane',
                points: [
                  { timestamp, value },
                  { timestamp, value: anchorPrice },
                ],
                extendData: {
                  text: textData,
                  color,
                  side: isBuy ? 'buy' : 'sell',
                },
                lock: true,
              })

              if (Array.isArray(overlayId)) {
                overlayIds.push(...overlayId)
              } else if (typeof overlayId === 'string') {
                overlayIds.push(overlayId)
              }
            }
          })

          signalOverlayIdsRef.current[pendingIndicatorId] = overlayIds
        })
      })
    }

    const dataList = chart.getDataList()

    selectedIndicators.forEach((indicator) => {
      if (isIndicatorDraft(indicator)) {
        warnings.push(`${indicator.name || indicator.id} is a draft indicator.`)
        invalidIndicatorIds.add(indicator.id)
        return
      }

      const compileResult = buildIndicatorTemplate(indicator, dataList)
      if (!compileResult.output) {
        const detail =
          compileResult.errors.length > 0 ? ` (${compileResult.errors.join('; ')})` : ''
        warnings.push(`${indicator.name || indicator.id} failed to compile.${detail}`)
        invalidIndicatorIds.add(indicator.id)
        return
      }

      if (compileResult.errors.length > 0) {
        warnings.push(
          `${indicator.name || indicator.id} compiled with warnings (${compileResult.errors.join('; ')})`
        )
      }

      enqueueSignals({
        indicatorId: indicator.id,
        signals: compileResult.output.signals,
        dataList,
      })

      if (compileResult.template) {
        registerIndicator(compileResult.template)
        compiledIndicatorIds.add(indicator.id)
        const isStack = compileResult.output.allOverlay
        paneTargets.set(indicator.id, {
          isStack,
          paneOptions: isStack ? { id: 'candle_pane' } : undefined,
        })
      }

      const fingerprint = [
        indicator.updatedAt ?? indicator.createdAt ?? '',
        indicator.name ?? '',
        indicator.color ?? '',
        indicator.calcCode ?? '',
        compileResult.output.plotSignature ?? '',
      ].join('|')

      const currentMap = indicatorInstanceMapRef.current
      const currentInstanceId = currentMap[indicator.id]
      const previousFingerprint = indicatorVersionRef.current[indicator.id]
      const needsRefresh =
        Boolean(currentInstanceId) && (!previousFingerprint || previousFingerprint !== fingerprint)

      if (needsRefresh && currentInstanceId) {
        chart.removeIndicator({ id: currentInstanceId })
        delete currentMap[indicator.id]
        delete indicatorVersionRef.current[indicator.id]
      }

      if (!compileResult.template && currentInstanceId) {
        chart.removeIndicator({ id: currentInstanceId })
        delete currentMap[indicator.id]
        delete indicatorVersionRef.current[indicator.id]
      } else {
        indicatorVersionRef.current[indicator.id] = fingerprint
      }
    })

    const currentMap = indicatorInstanceMapRef.current
    const existingIndicatorIds = new Set(
      chart
        .getIndicators({})
        .map((indicator) =>
          indicator && typeof indicator === 'object' && 'id' in indicator
            ? (indicator as { id?: string }).id
            : undefined
        )
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
    Object.entries(currentMap).forEach(([indicatorId, instanceId]) => {
      if (!existingIndicatorIds.has(instanceId)) {
        delete currentMap[indicatorId]
        delete indicatorVersionRef.current[indicatorId]
      }
    })

    selectedDefaultIndicators.forEach(({ id, template }) => {
      if (!template) return
      if (!registeredDefaultNamesRef.current.has(template.name)) {
        registerIndicator(template)
        registeredDefaultNamesRef.current.add(template.name)
      }
      const figures = Array.isArray(template.figures) ? template.figures : []
      const plotSignature = figures
        .map((figure) => `${figure.key}:${figure.type ?? ''}`)
        .join('|')
      const fingerprint = [
        'default',
        id,
        template.name ?? '',
        template.series ?? '',
        plotSignature,
      ].join('|')

      compiledIndicatorIds.add(id)

      const isStack = template.series === 'price'
      paneTargets.set(id, {
        isStack,
        paneOptions: isStack ? { id: 'candle_pane' } : undefined,
      })

      const currentInstanceId = currentMap[id]
      const previousFingerprint = indicatorVersionRef.current[id]
      const needsRefresh =
        Boolean(currentInstanceId) && (!previousFingerprint || previousFingerprint !== fingerprint)

      if (needsRefresh && currentInstanceId) {
        chart.removeIndicator({ id: currentInstanceId })
        delete currentMap[id]
        delete indicatorVersionRef.current[id]
      }

      indicatorVersionRef.current[id] = fingerprint
    })

    const selectedSet = new Set([
      ...customIds.filter((id) => indicatorMap.has(id)),
      ...defaultIds,
    ])

    Object.entries(currentMap).forEach(([indicatorId, instanceId]) => {
      if (!selectedSet.has(indicatorId) || invalidIndicatorIds.has(indicatorId)) {
        chart.removeIndicator({ id: instanceId })
        delete currentMap[indicatorId]
        delete indicatorVersionRef.current[indicatorId]
        const overlayIds = signalOverlayIdsRef.current[indicatorId] ?? []
        overlayIds.forEach((overlayId) => chart.removeOverlay({ id: overlayId }))
        delete signalOverlayIdsRef.current[indicatorId]
      }
    })

    selectedIndicators.forEach((indicator) => {
      if (currentMap[indicator.id]) return
      if (isIndicatorDraft(indicator)) return
      if (!compiledIndicatorIds.has(indicator.id)) return
      const paneTarget = paneTargets.get(indicator.id)
      const instanceId = chart.createIndicator(
        indicator.id,
        paneTarget?.isStack ?? false,
        paneTarget?.paneOptions
      )
      if (instanceId) {
        currentMap[indicator.id] = instanceId
        if (!indicatorVersionRef.current[indicator.id]) {
          indicatorVersionRef.current[indicator.id] =
            indicator.updatedAt ?? indicator.createdAt ?? ''
        }
      }
    })

    selectedDefaultIndicators.forEach(({ id, template }) => {
      if (!template) return
      if (currentMap[id]) return
      if (!compiledIndicatorIds.has(id)) return
      const paneTarget = paneTargets.get(id)
      const instanceId = chart.createIndicator(
        template.name,
        paneTarget?.isStack ?? false,
        paneTarget?.paneOptions
      )
      if (instanceId) {
        currentMap[id] = instanceId
        if (!indicatorVersionRef.current[id]) {
          indicatorVersionRef.current[id] = `default:${template.name}`
        }
      } else {
        warnings.push(`${id} failed to create.`)
      }
    })

    setChartWarnings((prev) => (areStringArraysEqual(prev, warnings) ? prev : warnings))
  }, [chartRef, dataVersion, indicatorInstanceMapRef, indicatorRefs, indicators, workspaceId])

  return chartWarnings
}
