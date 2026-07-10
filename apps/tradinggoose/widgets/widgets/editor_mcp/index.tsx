'use client'

import { Play, RefreshCw, RotateCcw, Save, Server, X } from 'lucide-react'
import { useMessages } from 'next-intl'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitMcpEditorAction } from '@/widgets/utils/mcp-editor-actions'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { readEntitySelectionState } from '@/widgets/widget-contracts'
import { resolveMcpServerId } from '@/widgets/widgets/_shared/mcp/utils'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { McpDropdown } from '@/widgets/widgets/components/mcp-dropdown'
import { mcpEditorWidgetContract } from '@/widgets/widgets/editor_mcp/contract'
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
  const actions = useWidgetConfigRuntimeActions()
  const copy = useMessages().workspace.widgets.mcpEditor

  const resolvedServerId = resolveMcpServerId({
    params,
  })

  const handleServerChange = (nextServerId: string | null) => {
    actions.patchWidgetParams({ mcpServerId: nextServerId })
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
  const copy = useMessages().workspace.widgets.mcpEditor
  const selectionState = readEntitySelectionState({
    params,
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
  contract: mcpEditorWidgetContract,
  icon: Server,
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
