import { useEffect } from 'react'
import {
  type ReviewTargetEventFields,
  spreadReviewTarget,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'

// ---------------------------------------------------------------------------
// Factory: useSelectionPersistence hook
// ---------------------------------------------------------------------------

export interface SelectionPersistenceConfig {
  /** CustomEvent name to listen for. */
  eventName: string
  /** Key used to read the entity ID from the event detail (e.g. `'customToolId'`). */
  detailIdKey: string
  /**
   * Key used to persist the entity ID into widget params.
   * Defaults to `detailIdKey` when omitted.
   */
  paramsIdKey?: string
  /** Fallback scope key when `scopeKey` is not supplied by the consumer. */
  defaultScopeKey?: string
}

export interface UseSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onEntitySelect?: (entityId: string | null) => void
  scopeKey?: string
}

/**
 * Creates a React hook that subscribes to a `CustomEvent` and persists the
 * selected entity ID into widget params (gray pair) or calls a callback
 * (non-gray pair).
 *
 * All four entity-selection files (`custom-tool-selection`, `skill-selection`,
 * `indicator-selection`, `mcp-selection`) share identical logic; only the
 * event name, detail ID key, and params ID key differ.
 */
export function createSelectionPersistenceHook(config: SelectionPersistenceConfig) {
  const { eventName, detailIdKey, defaultScopeKey } = config
  const paramsIdKey = config.paramsIdKey ?? config.detailIdKey

  return function useSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor = 'gray',
    onEntitySelect,
    scopeKey,
  }: UseSelectionPersistenceOptions) {
    useEffect(() => {
      if (!onWidgetParamsChange && !onEntitySelect) {
        return
      }

      const resolvedScopeKey = scopeKey ?? defaultScopeKey

      const handleSelect = (event: Event) => {
        const detail = (event as CustomEvent).detail as
          | (Record<string, unknown> & ReviewTargetEventFields)
          | undefined
        if (!detail?.widgetKey) return
        if (resolvedScopeKey && detail.widgetKey !== resolvedScopeKey) return
        if (panelId && detail.panelId && detail.panelId !== panelId) return

        const entityId = (detail[detailIdKey] as string | null | undefined) ?? null

        if (pairColor !== 'gray' && onEntitySelect) {
          onEntitySelect(entityId)
          return
        }

        if (pairColor !== 'gray') {
          return
        }

        const currentParams =
          params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

        onWidgetParamsChange?.({
          ...currentParams,
          [paramsIdKey]: entityId,
          ...spreadReviewTarget(detail),
        })
      }

      window.addEventListener(eventName, handleSelect as EventListener)

      return () => {
        window.removeEventListener(eventName, handleSelect as EventListener)
      }
    }, [onWidgetParamsChange, onEntitySelect, pairColor, panelId, params, scopeKey])
  }
}

// ---------------------------------------------------------------------------
// Factory: emitSelectionChange
// ---------------------------------------------------------------------------

export interface EmitSelectionChangeConfig {
  /** CustomEvent name to dispatch. */
  eventName: string
  /** Key used to store the entity ID in the event detail. */
  detailIdKey: string
}

export interface EmitSelectionChangeOptions extends ReviewTargetEventFields {
  entityId?: string | null
  panelId?: string
  widgetKey: string
}

/**
 * Creates an emit function that dispatches a `CustomEvent` with the entity ID
 * and review-target fields, matching the pattern used by all entity-selection
 * files.
 */
export function createEmitSelectionChange(config: EmitSelectionChangeConfig) {
  return function emitSelectionChange({
    entityId,
    panelId,
    widgetKey,
    ...reviewTarget
  }: EmitSelectionChangeOptions) {
    if (!widgetKey) return

    window.dispatchEvent(
      new CustomEvent(config.eventName, {
        detail: {
          [config.detailIdKey]: entityId ?? null,
          panelId,
          widgetKey,
          ...reviewTarget,
        },
      })
    )
  }
}
