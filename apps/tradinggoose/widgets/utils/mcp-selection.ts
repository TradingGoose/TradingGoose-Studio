import {
  MCP_WIDGET_SELECT_SERVER_EVENT,
  type McpWidgetSelectEventDetail,
  type ReviewTargetEventFields,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import {
  createSelectionPersistenceHook,
  createEmitSelectionChange,
  type UseSelectionPersistenceOptions,
} from '@/widgets/utils/selection-persistence-factory'

// Hook

const useMcpSelectionPersistenceGeneric = createSelectionPersistenceHook({
  eventName: MCP_WIDGET_SELECT_SERVER_EVENT,
  detailIdKey: 'serverId',
  paramsIdKey: 'mcpServerId',
})

interface UseMcpSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onServerSelect?: (serverId: string | null) => void
  scopeKey: string
}

export function useMcpSelectionPersistence({
  onServerSelect,
  ...rest
}: UseMcpSelectionPersistenceOptions) {
  const opts: UseSelectionPersistenceOptions = {
    ...rest,
    onEntitySelect: onServerSelect,
  }
  useMcpSelectionPersistenceGeneric(opts)
}

// Emit

const emitGeneric = createEmitSelectionChange({
  eventName: MCP_WIDGET_SELECT_SERVER_EVENT,
  detailIdKey: 'serverId',
})

interface EmitMcpSelectionOptions extends ReviewTargetEventFields {
  serverId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitMcpSelectionChange({
  serverId,
  ...rest
}: EmitMcpSelectionOptions) {
  emitGeneric({ ...rest, entityId: serverId })
}
