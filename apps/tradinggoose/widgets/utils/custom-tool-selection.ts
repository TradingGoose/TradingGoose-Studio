import { CUSTOM_TOOL_WIDGET_SELECT_EVENT } from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import {
  createEmitSelectionChange,
  createSelectionPersistenceHook,
  type UseSelectionPersistenceOptions,
} from '@/widgets/utils/selection-persistence-factory'

// Hook

const useCustomToolSelectionPersistenceGeneric = createSelectionPersistenceHook({
  eventName: CUSTOM_TOOL_WIDGET_SELECT_EVENT,
  detailIdKey: 'customToolId',
})

interface UseCustomToolSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onCustomToolSelect?: (customToolId: string | null) => void
  scopeKey: string
}

export function useCustomToolSelectionPersistence({
  onCustomToolSelect,
  ...rest
}: UseCustomToolSelectionPersistenceOptions) {
  const opts: UseSelectionPersistenceOptions = {
    ...rest,
    onEntitySelect: onCustomToolSelect,
  }
  useCustomToolSelectionPersistenceGeneric(opts)
}

// Emit

const emitGeneric = createEmitSelectionChange({
  eventName: CUSTOM_TOOL_WIDGET_SELECT_EVENT,
  detailIdKey: 'customToolId',
})

interface EmitCustomToolSelectionOptions {
  customToolId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitCustomToolSelectionChange({
  customToolId,
  ...rest
}: EmitCustomToolSelectionOptions) {
  emitGeneric({ ...rest, entityId: customToolId })
}
