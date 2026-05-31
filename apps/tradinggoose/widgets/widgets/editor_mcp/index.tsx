'use client'

import { Play, RefreshCw, RotateCcw, Save, Server, X } from 'lucide-react'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useAppMessages } from '@/i18n/client-messages'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitMcpEditorAction } from '@/widgets/utils/mcp-editor-actions'
import { emitMcpSelectionChange } from '@/widgets/utils/mcp-selection'
import { readEntitySelectionState, resolveMcpServerId } from '@/widgets/widgets/_shared/mcp/utils'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { McpDropdown } from '@/widgets/widgets/components/mcp-dropdown'
import { EditorMcpWidgetBody } from '@/widgets/widgets/editor_mcp/editor-mcp-body'

const McpEditorSelector = ({
  workspaceId,
  panelId,
  params,
  pairColor = 'gray',
  widgetKey,
}: {
  workspaceId?: string | null
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  widgetKey?: string
}) => {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const copy = useAppMessages().workspace.widgets.mcpEditor

  const resolvedServerId = resolveMcpServerId({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })

  const handleServerChange = (nextServerId: string | null) => {
    if (isLinkedToColorPair) {
      if (pairContext?.mcpServerId === nextServerId) return
      setPairContext(resolvedPairColor, { mcpServerId: nextServerId })
      return
    }

    emitMcpSelectionChange({
      serverId: nextServerId,
      panelId,
      widgetKey: widgetKey ?? 'editor_mcp',
    })
  }

  return (
    <McpDropdown
      workspaceId={workspaceId}
      value={resolvedServerId}
      onChange={(nextServerId) => handleServerChange(nextServerId)}
      placeholder={copy.selectServer}
      triggerClassName='min-w-[240px]'
    />
  )
}

const McpEditorHeaderActions = ({
  workspaceId,
  panelId,
  params,
  pairColor = 'gray',
  widgetKey,
}: {
  workspaceId?: string | null
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  widgetKey?: string
}) => {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const pairContext = usePairColorContext(resolvedPairColor)
  const copy = useAppMessages().workspace.widgets.mcpEditor
  const selectionState = readEntitySelectionState({
    params,
    pairContext: resolvedPairColor !== 'gray' ? pairContext : null,
    entityIdKey: 'mcpServerId',
  })
  const hasSelection = !!selectionState.selectedEntityId

  const emitAction = (action: 'save' | 'refresh' | 'close' | 'reset' | 'test') => {
    emitMcpEditorAction({
      action,
      panelId,
      widgetKey,
    })
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <EntityEditorHeaderButton
        tooltip={copy.refreshTools}
        label={copy.refreshTools}
        icon={RefreshCw}
        onClick={() => emitAction('refresh')}
        disabled={!workspaceId || !hasSelection}
        variant='outline'
      />
      <EntityEditorHeaderButton
        tooltip={copy.testConnection}
        label={copy.testConnection}
        icon={Play}
        onClick={() => emitAction('test')}
        disabled={!workspaceId || !hasSelection}
        variant='outline'
      />
      <EntityEditorHeaderButton
        tooltip={copy.resetForm}
        label={copy.resetForm}
        icon={RotateCcw}
        onClick={() => emitAction('reset')}
        disabled={!hasSelection}
        variant='secondary'
      />
      <EntityEditorHeaderButton
        tooltip={copy.saveServer}
        label={copy.saveServer}
        icon={Save}
        onClick={() => emitAction('save')}
        disabled={!workspaceId || !hasSelection}
        variant='default'
      />
      <EntityEditorHeaderButton
        tooltip={copy.clearSelection}
        label={copy.clearSelection}
        icon={X}
        onClick={() => emitAction('close')}
        disabled={!hasSelection}
        variant='ghost'
      />
    </div>
  )
}

export const editorMcpWidget: DashboardWidgetDefinition = {
  key: 'editor_mcp',
  title: 'MCP Editor',
  icon: Server,
  category: 'editor',
  description: 'Inspect, edit, test, and refresh a selected MCP server.',
  component: (props) => <EditorMcpWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const params =
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null

    return {
      center: (
        <McpEditorSelector
          workspaceId={context?.workspaceId}
          panelId={panelId}
          params={params}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
        />
      ),
      right: (
        <McpEditorHeaderActions
          workspaceId={context?.workspaceId}
          panelId={panelId}
          params={params}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
        />
      ),
    }
  },
}
