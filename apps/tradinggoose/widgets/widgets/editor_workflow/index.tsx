'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Workflow } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import {
  emitWorkflowParamsChange,
  emitWorkflowSelectionChange,
  useWorkflowSelectionPersistence,
} from '@/widgets/utils/workflow-selection'
import { MarketProviderControls } from '@/widgets/widgets/components/market-provider-controls'
import { WorkflowDropdown } from '@/widgets/widgets/components/workflow-dropdown'
import {
  getSeriesMarketProviderOptions,
  resolveConfiguredSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import { WorkflowWidgetControlBar } from '@/widgets/widgets/editor_workflow/components/workflow-controlbar'
import type { WorkflowCanvasUIConfig } from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import WorkflowEditorApp from '@/widgets/widgets/editor_workflow/components/workflow-editor-app'
import { WorkflowToolbar } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar'
import { WorkflowUIConfigProvider } from '@/widgets/widgets/editor_workflow/context/workflow-ui-context'

const WORKFLOW_WIDGET_UI_CONFIG: WorkflowCanvasUIConfig = {
  floatingControls: true,
}

const readWorkflowToolbarScopeId = (widgetKey: string, panelId?: string) =>
  `${widgetKey}::${panelId ?? 'panel'}`

type ViewportBounds = { x: number; y: number; width: number; height: number }
type WorkflowEditorWidgetParams = {
  marketProvider?: string
  marketProviderParams?: Record<string, unknown>
  marketAuth?: Record<string, unknown>
}

const WorkflowEditorWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId
  const widgetKey = widget?.key ?? 'editor_workflow'
  const toolbarScopeId = readWorkflowToolbarScopeId(widgetKey, panelId)
  const widgetParams = params as WorkflowEditorWidgetParams | null
  const marketProviderOptions = useMemo(() => getSeriesMarketProviderOptions(), [])
  const marketProviderId = resolveConfiguredSeriesMarketProviderId(
    widgetParams?.marketProvider,
    marketProviderOptions
  )
  const {
    channelId,
    resolvedPairColor,
    resolvedWorkflowId,
    hasLoadedWorkflows,
    loadError,
    isLoading,
    workflowIds,
  } = useWorkflowWidgetState({
    workspaceId,
    pairColor,
    widget,
    panelId,
    params,
    onWidgetParamsChange,
    fallbackWidgetKey: 'editor_workflow',
    loggerScope: 'workflow editor widget',
  })
  useWorkflowSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    pairColor: resolvedPairColor,
    params,
  })
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerElement((prev) => {
      if (prev === node) {
        return prev
      }
      return node
    })
  }, [])
  const [widgetBounds, setWidgetBounds] = useState<ViewportBounds | null>(null)

  useEffect(() => {
    if (!containerElement || typeof window === 'undefined') {
      return
    }

    let frame: number | null = null

    const updateBounds = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const rect = containerElement.getBoundingClientRect()
        const nextBounds: ViewportBounds = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        }
        setWidgetBounds((prev) => {
          if (
            prev &&
            Math.abs(prev.x - nextBounds.x) < 0.5 &&
            Math.abs(prev.y - nextBounds.y) < 0.5 &&
            Math.abs(prev.width - nextBounds.width) < 0.5 &&
            Math.abs(prev.height - nextBounds.height) < 0.5
          ) {
            return prev
          }
          return nextBounds
        })
      })
    }

    updateBounds()

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateBounds()) : null
    observer?.observe(containerElement)

    window.addEventListener('scroll', updateBounds, true)
    window.addEventListener('resize', updateBounds)

    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', updateBounds, true)
      window.removeEventListener('resize', updateBounds)
      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
  }, [containerElement])

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
    if (resolvedPairColor !== 'gray') {
      return <WidgetStateMessage message='This color has no shared workflow selected yet.' />
    }

    return (
      <div className='flex h-full w-full items-center justify-center '>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div ref={setContainerRef} className='relative flex h-full w-full overflow-hidden '>
      <WorkflowUIConfigProvider value={WORKFLOW_WIDGET_UI_CONFIG}>
        <WorkflowEditorApp
          workspaceId={workspaceId}
          workflowId={resolvedWorkflowId}
          channelId={channelId}
          marketProviderId={marketProviderId || undefined}
          toolbarScopeId={toolbarScopeId}
          ui={WORKFLOW_WIDGET_UI_CONFIG}
          viewportBounds={widgetBounds ?? undefined}
          disableNavigation={true}
        />
      </WorkflowUIConfigProvider>
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

type WorkflowEditorHeaderSelectorProps = {
  workspaceId?: string
  widget?: WidgetInstance | null
  panelId?: string
}

const WorkflowEditorHeaderSelector = ({
  workspaceId,
  widget,
  panelId,
}: WorkflowEditorHeaderSelectorProps) => {
  const { resolvedPairColor, resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    pairColor: widget?.pairColor ?? 'gray',
    widget: widget as WidgetComponentProps['widget'],
    panelId,
    params: widget?.params ?? null,
    fallbackWidgetKey: 'editor_workflow',
    loggerScope: 'workflow editor header',
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

type WorkflowEditorHeaderControlsProps = {
  workspaceId?: string
  widgetKey: string
  widgetParams: WorkflowEditorWidgetParams | null
  panelId?: string
  toolbarScopeId: string
}

const WorkflowEditorHeaderControls = ({
  workspaceId,
  widgetKey,
  widgetParams,
  panelId,
  toolbarScopeId,
}: WorkflowEditorHeaderControlsProps) => {
  const marketProviderOptions = useMemo(() => getSeriesMarketProviderOptions(), [])
  const marketProviderId = resolveConfiguredSeriesMarketProviderId(
    widgetParams?.marketProvider,
    marketProviderOptions
  )

  return (
    <>
      <MarketProviderControls
        value={marketProviderId}
        options={marketProviderOptions}
        onChange={(nextProvider) => {
          if (!nextProvider || nextProvider === marketProviderId) return
          emitWorkflowParamsChange({
            params: {
              marketProvider: nextProvider,
              marketProviderParams: null,
              marketAuth: null,
            },
            panelId,
            widgetKey,
          })
        }}
        providerParams={widgetParams?.marketProviderParams}
        authParams={widgetParams?.marketAuth}
        workspaceId={workspaceId}
        onSettingsSave={({ providerParams, auth }) => {
          emitWorkflowParamsChange({
            params: {
              marketProvider: marketProviderId,
              marketProviderParams: providerParams,
              marketAuth: auth,
            },
            panelId,
            widgetKey,
          })
        }}
      />
      <WorkflowToolbar workspaceId={workspaceId} toolbarScopeId={toolbarScopeId} />
    </>
  )
}

export const workflowEditorWidget: DashboardWidgetDefinition = {
  key: 'editor_workflow',
  title: 'Workflow Editor',
  icon: Workflow,
  category: 'editor',
  description: 'Canvas interface to build and edit workflows.',
  component: (props) => <WorkflowEditorWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const widgetKey = widget?.key ?? 'editor_workflow'
    const toolbarScopeId = readWorkflowToolbarScopeId(widgetKey, panelId)
    const widgetParams = widget?.params as WorkflowEditorWidgetParams | null

    return {
      left: (
        <WorkflowEditorHeaderControls
          workspaceId={context?.workspaceId}
          widgetKey={widgetKey}
          widgetParams={widgetParams}
          panelId={panelId}
          toolbarScopeId={toolbarScopeId}
        />
      ),
      center: (
        <WorkflowEditorHeaderSelector
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
      right: (
        <WorkflowWidgetControlBar
          workspaceId={context?.workspaceId}
          widget={widget}
          panelId={panelId}
        />
      ),
    }
  },
}
