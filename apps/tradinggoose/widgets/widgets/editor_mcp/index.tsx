'use client'

import { Play, RefreshCw, RotateCcw, Save, Server, X } from 'lucide-react'
import { useMessages } from 'next-intl'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitMcpEditorAction } from '@/widgets/utils/mcp-editor-actions'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { resolveEntityId } from '@/widgets/widget-contracts'
import { resolveMcpServerId } from '@/widgets/widgets/_shared/mcp/utils'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { McpDropdown } from '@/widgets/widgets/components/mcp-dropdown'
import { mcpEditorWidgetContract } from '@/widgets/widgets/editor_mcp/contract'
import { EditorMcpWidgetBody } from '@/widgets/widgets/editor_mcp/editor-mcp-body'

const McpEditorSelector = ({
  workspaceId,
  params,
}: {
  workspaceId?: string | null
  params?: Record<string, unknown> | null
}) => {
  const actions = useWidgetConfigRuntimeActions()
  const copy = useMessages().workspace.widgets.mcpEditor

  const resolvedServerId = resolveMcpServerId({
    params,
  })

  const handleServerChange = (nextServerId: string | null) => {
    actions.patchWidgetLinkedParams?.({ mcpServerId: nextServerId })
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
  widgetKey,
  canEditEntity,
}: {
  workspaceId?: string | null
  panelId?: string
  params?: Record<string, unknown> | null
  widgetKey?: string
  canEditEntity: boolean
}) => {
  const copy = useMessages().workspace.widgets.mcpEditor
  const hasSelection = !!resolveEntityId('mcpServerId', { params })

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
        disabled={!canEditEntity || !workspaceId || !hasSelection}
        variant='outline'
      />
      <EntityEditorHeaderButton
        tooltip={copy.testConnection}
        label={copy.testConnection}
        icon={Play}
        onClick={() => emitAction('test')}
        disabled={!canEditEntity || !workspaceId || !hasSelection}
        variant='outline'
      />
      <EntityEditorHeaderButton
        tooltip={copy.resetForm}
        label={copy.resetForm}
        icon={RotateCcw}
        onClick={() => emitAction('reset')}
        disabled={!canEditEntity || !hasSelection}
        variant='secondary'
      />
      <EntityEditorHeaderButton
        tooltip={copy.saveServer}
        label={copy.saveServer}
        icon={Save}
        onClick={() => emitAction('save')}
        disabled={!canEditEntity || !workspaceId || !hasSelection}
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
      center: <McpEditorSelector workspaceId={context?.workspaceId} params={params} />,
      right: (
        <McpEditorHeaderActions
          workspaceId={context?.workspaceId}
          panelId={panelId}
          params={params}
          widgetKey={widget?.key}
          canEditEntity={context?.canWrite !== false}
        />
      ),
    }
  },
}
