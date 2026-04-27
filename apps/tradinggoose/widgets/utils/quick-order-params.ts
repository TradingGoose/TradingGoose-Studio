import { useEffect, useRef } from 'react'
import {
  QUICK_ORDER_WIDGET_UPDATE_PARAMS_EVENT,
  type QuickOrderWidgetUpdateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'

interface UseQuickOrderParamsPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const areValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (!isRecord(left) || !isRecord(right)) return false

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (!(key in right)) return false
    if (!Object.is(left[key], right[key])) return false
  }

  return true
}

export const sanitizeQuickOrderParams = (
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!params || !isRecord(params)) return null

  const nextParams: Record<string, unknown> = {}
  const provider = normalizeString(params.provider)
  const credentialId = normalizeString(params.credentialId)
  const environment = normalizeString(params.environment)
  const accountId = normalizeString(params.accountId)
  const side = normalizeString(params.side)

  if (provider) nextParams.provider = provider
  if (credentialId) nextParams.credentialId = credentialId
  if (environment === 'paper' || environment === 'live') nextParams.environment = environment
  if (accountId) nextParams.accountId = accountId
  if (side === 'buy' || side === 'sell') nextParams.side = side

  return Object.keys(nextParams).length > 0 ? nextParams : null
}

const mergeQuickOrderParams = (
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
) => sanitizeQuickOrderParams({ ...(currentParams ?? {}), ...incomingParams })

export function useQuickOrderParamsPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
}: UseQuickOrderParamsPersistenceOptions) {
  const latestParamsRef = useRef<Record<string, unknown> | null>(sanitizeQuickOrderParams(params))

  useEffect(() => {
    latestParamsRef.current = sanitizeQuickOrderParams(params)
  }, [params])

  useEffect(() => {
    if (!onWidgetParamsChange) return

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<QuickOrderWidgetUpdateEventDetail>).detail
      if (!detail?.params || !isRecord(detail.params)) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams = latestParamsRef.current
      const nextParams = mergeQuickOrderParams(currentParams, detail.params)

      if (areValuesEqual(currentParams, nextParams)) return

      latestParamsRef.current = nextParams
      onWidgetParamsChange(nextParams)
    }

    window.addEventListener(QUICK_ORDER_WIDGET_UPDATE_PARAMS_EVENT, handleParamsUpdate)

    return () => {
      window.removeEventListener(QUICK_ORDER_WIDGET_UPDATE_PARAMS_EVENT, handleParamsUpdate)
    }
  }, [onWidgetParamsChange, panelId, widget?.key])
}

export function emitQuickOrderParamsChange({
  params,
  panelId,
  widgetKey,
}: {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}) {
  if (!params || Object.keys(params).length === 0) return

  window.dispatchEvent(
    new CustomEvent<QuickOrderWidgetUpdateEventDetail>(QUICK_ORDER_WIDGET_UPDATE_PARAMS_EVENT, {
      detail: {
        params,
        panelId,
        widgetKey,
      },
    })
  )
}
