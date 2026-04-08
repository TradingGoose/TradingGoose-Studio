import {
  INDICATOR_WIDGET_SELECT_EVENT,
  type IndicatorWidgetSelectEventDetail,
  type ReviewTargetEventFields,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import {
  createSelectionPersistenceHook,
  createEmitSelectionChange,
  type UseSelectionPersistenceOptions,
} from '@/widgets/utils/selection-persistence-factory'

const DEFAULT_SCOPE_KEY = 'editor_indicator'

// Hook

const useIndicatorSelectionPersistenceGeneric = createSelectionPersistenceHook({
  eventName: INDICATOR_WIDGET_SELECT_EVENT,
  detailIdKey: 'indicatorId',
  defaultScopeKey: DEFAULT_SCOPE_KEY,
})

interface UseIndicatorSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onIndicatorSelect?: (indicatorId: string | null) => void
  scopeKey?: string
}

export function useIndicatorSelectionPersistence({
  onIndicatorSelect,
  ...rest
}: UseIndicatorSelectionPersistenceOptions) {
  const opts: UseSelectionPersistenceOptions = {
    ...rest,
    onEntitySelect: onIndicatorSelect,
  }
  useIndicatorSelectionPersistenceGeneric(opts)
}

// Emit

const emitGeneric = createEmitSelectionChange({
  eventName: INDICATOR_WIDGET_SELECT_EVENT,
  detailIdKey: 'indicatorId',
})

interface EmitIndicatorSelectionOptions extends ReviewTargetEventFields {
  indicatorId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitIndicatorSelectionChange({
  indicatorId,
  ...rest
}: EmitIndicatorSelectionOptions) {
  emitGeneric({ ...rest, entityId: indicatorId })
}
