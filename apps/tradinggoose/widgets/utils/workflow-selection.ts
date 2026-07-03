import { WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT } from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import {
  createEmitSelectionChange,
  createSelectionPersistenceHook,
  type UseSelectionPersistenceOptions,
} from '@/widgets/utils/selection-persistence-factory'

const useWorkflowSelectionPersistenceGeneric = createSelectionPersistenceHook({
  eventName: WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
  detailIdKey: 'workflowId',
})

interface UseWorkflowSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onWorkflowSelect?: (workflowId: string | null) => void
  scopeKey: string
}

export function useWorkflowSelectionPersistence({
  onWorkflowSelect,
  ...rest
}: UseWorkflowSelectionPersistenceOptions) {
  const opts: UseSelectionPersistenceOptions = {
    ...rest,
    onEntitySelect: onWorkflowSelect,
  }
  useWorkflowSelectionPersistenceGeneric(opts)
}

const emitGeneric = createEmitSelectionChange({
  eventName: WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
  detailIdKey: 'workflowId',
})

interface EmitWorkflowSelectionOptions {
  workflowId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitWorkflowSelectionChange({
  workflowId,
  ...rest
}: EmitWorkflowSelectionOptions) {
  emitGeneric({ ...rest, entityId: workflowId })
}
