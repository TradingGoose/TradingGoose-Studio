'use client'

import { Play, RefreshCw, RotateCcw, Save, Server, X } from 'lucide-react'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitMcpEditorAction } from '@/widgets/utils/mcp-editor-actions'
import { emitMcpSelectionChange } from '@/widgets/utils/mcp-selection'
import { McpDropdown } from '@/widgets/widgets/components/mcp-dropdown'
import {
  EntityEditorHeaderButton,
  EntityEditorRedoButton,
  EntityEditorUndoButton,
} from '@/widgets/widgets/components/entity-editor-buttons'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { EditorMcpWidgetBody } from '@/widgets/widgets/editor_mcp/editor-mcp-body'
import {
  buildPersistedPairContext,
  readEntitySelectionState,
  resolveMcpServerId,
} from '@/widgets/widgets/_shared/mcp/utils'

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

  const resolvedServerId = resolveMcpServerId({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })

  const handleServerChange = (nextServerId: string | null) => {
    if (isLinkedToColorPair) {
      if (pairContext?.mcpServerId === nextServerId) return
      setPairContext(
        resolvedPairColor,
        buildPersistedPairContext({
          existing: pairContext,
          legacyIdKey: 'mcpServerId',
          descriptor: null,
          legacyEntityId: nextServerId,
        })
      )
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
      placeholder='Select server'
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
  const selectionState = readEntitySelectionState({
    params,
    pairContext: resolvedPairColor !== 'gray' ? pairContext : null,
    legacyIdKey: 'mcpServerId',
  })
  const hasSelection =
    !!selectionState.legacyEntityId ||
    !!selectionState.reviewSessionId ||
    !!selectionState.reviewDraftSessionId
  const hasCanonicalEntity = !!(selectionState.reviewEntityId ?? selectionState.legacyEntityId)

  const emitAction = (
    action: 'save' | 'refresh' | 'close' | 'reset' | 'test' | 'undo' | 'redo'
  ) => {
    emitMcpEditorAction({
      action,
      panelId,
      widgetKey,
    })
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <EntityEditorUndoButton
        reviewSessionId={selectionState.reviewSessionId}
        onAction={() => emitAction('undo')}
      />
      <EntityEditorRedoButton
        reviewSessionId={selectionState.reviewSessionId}
        onAction={() => emitAction('redo')}
      />
      <EntityEditorHeaderButton
        tooltip='Refresh tools'
        label='Refresh tools'
        icon={RefreshCw}
        onClick={() => emitAction('refresh')}
        disabled={!workspaceId || !hasCanonicalEntity}
        variant='outline'
      />
      <EntityEditorHeaderButton
        tooltip='Test connection'
        label='Test connection'
        icon={Play}
        onClick={() => emitAction('test')}
        disabled={!workspaceId || !hasCanonicalEntity}
        variant='outline'
      />
      <EntityEditorHeaderButton
        tooltip='Reset form'
        label='Reset form'
        icon={RotateCcw}
        onClick={() => emitAction('reset')}
        disabled={!hasSelection}
        variant='secondary'
      />
      <EntityEditorHeaderButton
        tooltip='Save server'
        label='Save server'
        icon={Save}
        onClick={() => emitAction('save')}
        disabled={!workspaceId || !hasSelection}
        variant='default'
      />
      <EntityEditorHeaderButton
        tooltip='Clear selection'
        label='Clear selection'
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
