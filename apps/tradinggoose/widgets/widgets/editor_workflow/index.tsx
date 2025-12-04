'use client'

import { useCallback, useEffect, useState } from 'react'
import { Workflow } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { WorkflowUIConfigProvider } from '@/widgets/widgets/editor_workflow/context/workflow-ui-context'
import {
  type WorkflowCanvasUIConfig,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import WorkflowEditorApp from '@/widgets/widgets/editor_workflow/components/workflow-editor-app'
import {
  getWorkflowWidgetChannelId,
  WorkflowWidgetControlBar,
} from '@/widgets/widgets/editor_workflow/components/workflow-controlbar'
import { WorkflowToolbar } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar'
import {
  WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
  type WorkflowWidgetSelectEventDetail,
} from '@/widgets/events'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import { isPairColor } from '@/widgets/pair-colors'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { WorkflowDropdown } from '@/widgets/widgets/shared/components/workflow-dropdown'

const WORKFLOW_WIDGET_UI_CONFIG: WorkflowCanvasUIConfig = {
  floatingControls: true,
  trainingControls: true,
  // Respect user toggle for training controls in the widget
  forceTrainingControls: false,
}

type ViewportBounds = { x: number; y: number; width: number; height: number }

const WorkflowEditorWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  useEffect(() => {
    if (!onWidgetParamsChange || pairColor !== 'gray') {
      return
    }

    const handleWorkflowSelect = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowWidgetSelectEventDetail>).detail
      if (!detail?.workflowId) {
        return
      }
      if (panelId && detail.panelId && detail.panelId !== panelId) {
        return
      }
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) {
        return
      }

      const currentParams =
        widget?.params && typeof widget.params === 'object'
          ? (widget.params as Record<string, unknown>)
          : {}
      onWidgetParamsChange({ ...currentParams, workflowId: detail.workflowId })
    }

    window.addEventListener(
      WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
      handleWorkflowSelect as EventListener
    )
    return () => {
      window.removeEventListener(
        WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT,
        handleWorkflowSelect as EventListener
      )
    }
  }, [onWidgetParamsChange, pairColor, panelId, widget?.key, widget?.params])

  const workspaceId = context?.workspaceId
  const widgetKey = widget?.key ?? 'workflow-editor'
  const {
    channelId,
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
    fallbackWidgetKey: 'workflow-editor',
    loggerScope: 'workflow editor widget',
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
      <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))]'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message='No workflows available in this workspace.' />
  }

  if (!resolvedWorkflowId) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))]'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div
      ref={setContainerRef}
      className='relative flex h-full w-full overflow-hidden bg-[hsl(var(--workflow-background))]'
    >
      <WorkflowUIConfigProvider value={WORKFLOW_WIDGET_UI_CONFIG}>
        <WorkflowEditorApp
          workspaceId={workspaceId}
          workflowId={resolvedWorkflowId}
          channelId={channelId}
          ui={WORKFLOW_WIDGET_UI_CONFIG}
          viewportBounds={widgetBounds ?? undefined}
          disableNavigation={true}
        />
      </WorkflowUIConfigProvider>
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))] px-4 text-center text-muted-foreground text-xs'>
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
    fallbackWidgetKey: 'workflow-editor',
    loggerScope: 'workflow editor header',
    activateWorkflow: false,
  })

  const handleWorkflowChange = (workflowId: string) => {
    if (resolvedPairColor !== 'gray') {
      return
    }

    window.dispatchEvent(
      new CustomEvent<WorkflowWidgetSelectEventDetail>(WORKFLOW_WIDGET_SELECT_WORKFLOW_EVENT, {
        detail: {
          panelId,
          widgetKey: widget?.key,
          workflowId,
        },
      })
    )
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

export const workflowEditorWidget: DashboardWidgetDefinition = {
  key: 'editor_workflow',
  title: 'Workflow Editor',
  icon: Workflow,
  category: 'editor',
  description: 'Canvas interface to build and edit workflows.',
  component: (props) => <WorkflowEditorWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const resolvedPairColor = isPairColor(widget?.pairColor) ? widget.pairColor : 'gray'
    const widgetKey = widget?.key ?? 'workflow-editor'
    const channelId = getWorkflowWidgetChannelId(resolvedPairColor, widgetKey, panelId)

    return {
      left: (
        <WorkflowToolbar workspaceId={context?.workspaceId} channelId={channelId} />
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
