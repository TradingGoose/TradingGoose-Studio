import { useEffect, useRef } from 'react'
import {
  PORTFOLIO_SNAPSHOT_WIDGET_UPDATE_PARAMS_EVENT,
  type PortfolioSnapshotWidgetUpdateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'

interface UsePortfolioSnapshotParamsPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const areValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false

    for (let index = 0; index < left.length; index += 1) {
      if (!areValuesEqual(left[index], right[index])) {
        return false
      }
    }

    return true
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
      if (!(key in right)) return false
      if (!areValuesEqual(left[key], right[key])) return false
    }

    return true
  }

  return false
}

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const sanitizePortfolioSnapshotParams = (
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!params || !isRecord(params)) return null

  const runtime = isRecord(params.runtime) ? params.runtime : null
  const refreshAt =
    typeof runtime?.refreshAt === 'number' && Number.isFinite(runtime.refreshAt)
      ? runtime.refreshAt
      : undefined

  const nextParams: Record<string, unknown> = {}
  const provider = normalizeString(params.provider)
  const credentialId = normalizeString(params.credentialId)
  const environment = normalizeString(params.environment)
  const accountId = normalizeString(params.accountId)
  const selectedWindow = normalizeString(params.selectedWindow)

  if (provider) nextParams.provider = provider
  if (credentialId) nextParams.credentialId = credentialId
  if (environment === 'paper' || environment === 'live') {
    nextParams.environment = environment
  }
  if (accountId) nextParams.accountId = accountId
  if (selectedWindow) nextParams.selectedWindow = selectedWindow
  if (refreshAt !== undefined) {
    nextParams.runtime = {
      refreshAt,
    }
  }

  return Object.keys(nextParams).length > 0 ? nextParams : null
}

const mergePortfolioSnapshotParams = (
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
) => {
  const currentRuntime = isRecord(currentParams?.runtime) ? currentParams.runtime : null
  const incomingRuntime = isRecord(incomingParams.runtime) ? incomingParams.runtime : null
  const mergedRuntime =
    currentRuntime || incomingRuntime
      ? {
          ...(currentRuntime ?? {}),
          ...(incomingRuntime ?? {}),
        }
      : undefined

  const merged = {
    ...(currentParams ?? {}),
    ...incomingParams,
    ...(mergedRuntime ? { runtime: mergedRuntime } : {}),
  }

  return sanitizePortfolioSnapshotParams(merged)
}

export function usePortfolioSnapshotParamsPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
}: UsePortfolioSnapshotParamsPersistenceOptions) {
  const latestParamsRef = useRef<Record<string, unknown> | null>(
    sanitizePortfolioSnapshotParams(params)
  )

  useEffect(() => {
    latestParamsRef.current = sanitizePortfolioSnapshotParams(params)
  }, [params])

  useEffect(() => {
    if (!onWidgetParamsChange) {
      return
    }

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<PortfolioSnapshotWidgetUpdateEventDetail>).detail
      if (!detail?.params || !isRecord(detail.params)) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams = latestParamsRef.current
      const nextParams = mergePortfolioSnapshotParams(currentParams, detail.params)

      if (areValuesEqual(currentParams, nextParams)) {
        return
      }

      latestParamsRef.current = nextParams
      onWidgetParamsChange(nextParams)
    }

    window.addEventListener(
      PORTFOLIO_SNAPSHOT_WIDGET_UPDATE_PARAMS_EVENT,
      handleParamsUpdate as EventListener
    )

    return () => {
      window.removeEventListener(
        PORTFOLIO_SNAPSHOT_WIDGET_UPDATE_PARAMS_EVENT,
        handleParamsUpdate as EventListener
      )
    }
  }, [onWidgetParamsChange, panelId, widget?.key])
}

export function emitPortfolioSnapshotParamsChange({
  params,
  panelId,
  widgetKey,
}: {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}) {
  if (!params || Object.keys(params).length === 0) {
    return
  }

  window.dispatchEvent(
    new CustomEvent<PortfolioSnapshotWidgetUpdateEventDetail>(
      PORTFOLIO_SNAPSHOT_WIDGET_UPDATE_PARAMS_EVENT,
      {
        detail: {
          params,
          panelId,
          widgetKey,
        },
      }
    )
  )
}
