'use client'

import type { ComponentType } from 'react'
import { Play, RefreshCw, RotateCcw, Save, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitMcpEditorAction } from '@/widgets/utils/mcp-editor-actions'
import { emitMcpSelectionChange } from '@/widgets/utils/mcp-selection'
import { McpDropdown } from '@/widgets/widgets/components/mcp-dropdown'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { EditorMcpWidgetBody } from '@/widgets/widgets/editor_mcp/editor-mcp-body'
import { resolveMcpServerId } from '@/widgets/widgets/mcp/utils'

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
      placeholder='Select server'
      triggerClassName='min-w-[240px]'
    />
  )
}

const McpEditorHeaderButton = ({
  tooltip,
  label,
  icon: Icon,
  onClick,
  disabled = false,
  variant = 'outline',
}: {
  tooltip: string
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'secondary' | 'outline' | 'ghost'
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className='inline-flex'>
        <Button
          type='button'
          variant={variant}
          size='sm'
          className='h-7 w-7 text-xs'
          onClick={onClick}
          disabled={disabled}
        >
          <Icon className='h-4 w-4' />
          <span className='sr-only'>{label}</span>
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent side='top'>{tooltip}</TooltipContent>
  </Tooltip>
)

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
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const resolvedServerId = resolveMcpServerId({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })
  const hasSelection = Boolean(resolvedServerId)

  const emitAction = (action: 'save' | 'refresh' | 'close' | 'reset' | 'test') => {
    emitMcpEditorAction({
      action,
      panelId,
      widgetKey,
    })
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <McpEditorHeaderButton
        tooltip='Refresh tools'
        label='Refresh tools'
        icon={RefreshCw}
        onClick={() => emitAction('refresh')}
        disabled={!workspaceId || !hasSelection}
        variant='outline'
      />
      <McpEditorHeaderButton
        tooltip='Test connection'
        label='Test connection'
        icon={Play}
        onClick={() => emitAction('test')}
        disabled={!workspaceId || !hasSelection}
        variant='outline'
      />
      <McpEditorHeaderButton
        tooltip='Reset form'
        label='Reset form'
        icon={RotateCcw}
        onClick={() => emitAction('reset')}
        disabled={!hasSelection}
        variant='secondary'
      />
      <McpEditorHeaderButton
        tooltip='Save server'
        label='Save server'
        icon={Save}
        onClick={() => emitAction('save')}
        disabled={!workspaceId || !hasSelection}
        variant='default'
      />
      <McpEditorHeaderButton
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
  component: (props: WidgetComponentProps) => <EditorMcpWidgetBody {...props} />,
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
