import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Braces,
  Trash2,
  WrapText,
} from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import {
  emitWorkflowSelectionChange,
  useWorkflowSelectionPersistence,
} from '@/widgets/utils/workflow-selection'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { WorkflowDropdown } from '@/widgets/widgets/components/workflow-dropdown'
import { FilterPopover } from './components/terminal/components/filter-popover'
import { useWorkflowConsoleUiState } from './components/terminal/terminal-ui-store'
import type { BlockInfo } from './components/terminal/types'
import { filterEntries } from './components/terminal/utils'
import WorkflowConsoleApp from './components/workflow-console-app'

const WorkflowConsoleWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId
  const {
    channelId,
    resolvedPairColor,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading,
    workflowIds,
    activeWorkflowIdForChannel,
  } = useWorkflowWidgetState({
    workspaceId,
    pairColor,
    widget,
    panelId,
    params,
    onWidgetParamsChange,
    fallbackWidgetKey: 'workflow-console',
    loggerScope: 'workflow console widget',
  })
  useWorkflowSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    pairColor: resolvedPairColor,
    params,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(0)
  const fallbackPanelWidth = typeof window !== 'undefined' ? window.innerWidth : 1200

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setPanelWidth(containerRef.current.clientWidth)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to load workflows.' />
  }

  if (loadError) {
    return <WidgetStateMessage message={loadError} />
  }

  if (!hasLoadedWorkflows || isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center '>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message='No workflows available in this workspace.' />
  }

  if (!resolvedWorkflowId) {
    return (
      <div className='flex h-full w-full items-center justify-center '>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div ref={containerRef} className='flex h-full w-full overflow-hidden p-1'>
      <WorkflowConsoleApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
        panelWidth={panelWidth || fallbackPanelWidth}
        channelId={channelId}
        panelId={panelId}
      />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center  px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

type WorkflowConsoleHeaderControlsProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const WorkflowConsoleHeaderControls = ({
  workspaceId,
  widget,
  panelId,
}: WorkflowConsoleHeaderControlsProps) => {
  const { resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    panelId,
    params: widget?.params ?? null,
    fallbackWidgetKey: 'workflow-console',
    loggerScope: 'workflow console header controls',
    activateWorkflow: false,
  })

  const entries = useConsoleStore((state) => state.entries)
  const exportConsoleCSV = useConsoleStore((state) => state.exportConsoleCSV)
  const clearConsole = useConsoleStore((state) => state.clearConsole)

  const uiKey =
    panelId ??
    (workspaceId && resolvedWorkflowId
      ? `${workspaceId}-${resolvedWorkflowId}`
      : 'workflow-console')

  const {
    filters,
    sortConfig,
    toggleBlock,
    toggleStatus,
    toggleSort,
    hasActiveFilters,
    detailView,
    toggleStructuredView,
    toggleWrapText,
  } = useWorkflowConsoleUiState(uiKey)

  const workflowEntries = useMemo(() => {
    if (!resolvedWorkflowId) return []
    return entries.filter((entry) => entry.workflowId === resolvedWorkflowId)
  }, [entries, resolvedWorkflowId])

  const filteredEntries = useMemo(
    () => filterEntries(workflowEntries, filters, sortConfig),
    [workflowEntries, filters, sortConfig]
  )

  const uniqueBlocks = useMemo<BlockInfo[]>(() => {
    const map = new Map<string, { blockName: string; blockType: string }>()
    workflowEntries.forEach((entry) => {
      if (!map.has(entry.blockId)) {
        map.set(entry.blockId, {
          blockName: entry.blockName || entry.blockId,
          blockType: entry.blockType || 'unknown',
        })
      }
    })
    return Array.from(map.entries()).map(([blockId, info]) => ({
      blockId,
      blockName: info.blockName,
      blockType: info.blockType,
    }))
  }, [workflowEntries])

  const isDisabled = !resolvedWorkflowId
  const hasEntries = filteredEntries.length > 0

  const handleExportConsole = useCallback(() => {
    if (!resolvedWorkflowId) return
    exportConsoleCSV(resolvedWorkflowId)
  }, [exportConsoleCSV, resolvedWorkflowId])

  const handleClearConsole = useCallback(() => {
    if (!resolvedWorkflowId) return
    clearConsole(resolvedWorkflowId)
  }, [clearConsole, resolvedWorkflowId])

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <FilterPopover
        filters={filters}
        toggleStatus={toggleStatus}
        toggleBlock={toggleBlock}
        uniqueBlocks={uniqueBlocks}
        hasActiveFilters={hasActiveFilters}
        triggerClassName={widgetHeaderIconButtonClassName()}
        disabled={isDisabled || workflowEntries.length === 0}
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={toggleSort}
            aria-label='Sort by time'
            disabled={isDisabled || workflowEntries.length === 0}
          >
            {sortConfig.direction === 'desc' ? (
              <ArrowDown className='h-3.5 w-3.5' />
            ) : (
              <ArrowUp className='h-3.5 w-3.5' />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Sort by time</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={cn(
              widgetHeaderIconButtonClassName(),
              detailView.structuredView && 'text-primary'
            )}
            onClick={toggleStructuredView}
            aria-label='Toggle structured view'
            aria-pressed={detailView.structuredView}
            disabled={isDisabled}
          >
            <Braces className='h-3.5 w-3.5' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Structured view</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={cn(widgetHeaderIconButtonClassName(), detailView.wrapText && 'text-primary')}
            onClick={toggleWrapText}
            aria-label='Toggle wrap text'
            aria-pressed={detailView.wrapText}
            disabled={isDisabled}
          >
            <WrapText className='h-3.5 w-3.5' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Wrap text</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={handleExportConsole}
            aria-label='Download console CSV'
            disabled={isDisabled || !hasEntries}
          >
            <ArrowDownToLine className='h-3.5 w-3.5' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Download CSV</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={handleClearConsole}
            aria-label='Clear console'
            disabled={isDisabled || !hasEntries}
          >
            <Trash2 className='h-3.5 w-3.5' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Clear console</TooltipContent>
      </Tooltip>
    </div>
  )
}

type WorkflowConsoleHeaderSelectorProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const WorkflowConsoleHeaderSelector = ({
  workspaceId,
  widget,
  panelId,
}: WorkflowConsoleHeaderSelectorProps) => {
  const { resolvedPairColor, resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget,
    panelId,
    params: widget?.params ?? null,
    fallbackWidgetKey: 'workflow-console',
    loggerScope: 'workflow console header',
    activateWorkflow: false,
  })

  const handleWorkflowChange = (workflowId: string) => {
    if (resolvedPairColor !== 'gray') {
      return
    }

    emitWorkflowSelectionChange({
      panelId,
      widgetKey: widget?.key ?? undefined,
      workflowId,
    })
  }

  return (
    <WorkflowDropdown
      workspaceId={workspaceId}
      pairColor={resolvedPairColor}
      value={resolvedWorkflowId}
      onChange={handleWorkflowChange}
    />
  )
}

export const workflowConsoleWidget: DashboardWidgetDefinition = {
  key: 'workflow_console',
  title: 'Workflow Console',
  icon: Activity,
  category: 'utility',
  description: 'Live workflow execution console with logs and streaming output.',
  component: (props) => <WorkflowConsoleWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    return {
      center: (
        <WorkflowConsoleHeaderSelector
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
      right: (
        <WorkflowConsoleHeaderControls
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
    }
  },
}
