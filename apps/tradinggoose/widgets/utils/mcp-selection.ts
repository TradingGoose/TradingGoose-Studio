import { useEffect } from 'react'
import { MCP_WIDGET_SELECT_SERVER_EVENT, type McpWidgetSelectEventDetail } from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'

interface UseMcpSelectionPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  onServerSelect?: (serverId: string | null) => void
  scopeKey: string
}

export function useMcpSelectionPersistence({
  onWidgetParamsChange,
  panelId,
  params,
  pairColor = 'gray',
  onServerSelect,
  scopeKey,
}: UseMcpSelectionPersistenceOptions) {
  useEffect(() => {
    if (!onWidgetParamsChange && !onServerSelect) {
      return
    }

    const handleServerSelect = (event: Event) => {
      const detail = (event as CustomEvent<McpWidgetSelectEventDetail>).detail
      if (!detail?.widgetKey) return
      if (detail.widgetKey !== scopeKey) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return

      if (pairColor !== 'gray' && onServerSelect) {
        onServerSelect(detail.serverId ?? null)
        return
      }

      if (pairColor !== 'gray') {
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        mcpServerId: detail.serverId ?? null,
      })
    }

    window.addEventListener(MCP_WIDGET_SELECT_SERVER_EVENT, handleServerSelect as EventListener)

    return () => {
      window.removeEventListener(
        MCP_WIDGET_SELECT_SERVER_EVENT,
        handleServerSelect as EventListener
      )
    }
  }, [onWidgetParamsChange, onServerSelect, pairColor, panelId, params, scopeKey])
}

interface EmitMcpSelectionOptions {
  serverId?: string | null
  panelId?: string
  widgetKey: string
}

export function emitMcpSelectionChange({ serverId, panelId, widgetKey }: EmitMcpSelectionOptions) {
  if (!widgetKey) return

  window.dispatchEvent(
    new CustomEvent<McpWidgetSelectEventDetail>(MCP_WIDGET_SELECT_SERVER_EVENT, {
      detail: {
        serverId: serverId ?? null,
        panelId,
        widgetKey,
      },
    })
  )
}
