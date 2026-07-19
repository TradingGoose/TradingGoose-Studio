'use client'

import { useCallback, useEffect, useState } from 'react'
import { Workflow } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import {
  useWorkflowDropdownMessages,
  useWorkflowEditorMessages,
} from '@/i18n/workspace-widget-hooks'
import { useWorkflowWidgetState } from '@/widgets/hooks/use-workflow-widget-state'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { WorkflowDropdown } from '@/widgets/widgets/components/workflow-dropdown'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { WorkflowWidgetControlBar } from '@/widgets/widgets/editor_workflow/components/workflow-controlbar'
import type { WorkflowCanvasUIConfig } from '@/widgets/widgets/editor_workflow/components/workflow-editor/workflow-canvas'
import WorkflowEditorApp from '@/widgets/widgets/editor_workflow/components/workflow-editor-app'
import { WorkflowToolbar } from '@/widgets/widgets/editor_workflow/components/workflow-toolbar'
import { WorkflowUIConfigProvider } from '@/widgets/widgets/editor_workflow/context/workflow-ui-context'
import { workflowEditorWidgetContract } from '@/widgets/widgets/editor_workflow/contract'

const WORKFLOW_WIDGET_UI_CONFIG: WorkflowCanvasUIConfig = {
  floatingControls: true,
}

const readWorkflowToolbarScopeId = (widgetKey: string, panelId?: string) =>
  `${widgetKey}::${panelId ?? 'panel'}`

type ViewportBounds = { x: number; y: number; width: number; height: number }

const WorkflowEditorWidgetBody = ({
  channelId,
  params,
  context,
  panelId,
  widget,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId
  const canWrite = context?.canWrite !== false
  const copy = useWorkflowEditorMessages()
  const dropdownCopy = useWorkflowDropdownMessages()
  const widgetKey = widget?.key ?? 'editor_workflow'
  const toolbarScopeId = readWorkflowToolbarScopeId(widgetKey, panelId)
  const { resolvedWorkflowId, hasLoadedWorkflows, loadError, isLoading, workflowIds } =
    useWorkflowWidgetState({
      workspaceId,
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
    return <WidgetStateMessage message={copy.selectWorkspaceToLoadWorkflows} />
  }

  if (loadError) {
    return <WidgetStateMessage message={copy[loadError]} />
  }

  if (!hasLoadedWorkflows || isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center '>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message={copy.noWorkflowsAvailable} />
  }

  if (!resolvedWorkflowId) {
    return <WidgetStateMessage message={dropdownCopy.selectWorkflow} />
  }

  return (
    <div ref={setContainerRef} className='relative flex h-full w-full overflow-hidden '>
      <WorkflowUIConfigProvider value={WORKFLOW_WIDGET_UI_CONFIG}>
        <WorkflowEditorApp
          workspaceId={workspaceId}
          workflowId={resolvedWorkflowId}
          channelId={channelId}
          toolbarScopeId={toolbarScopeId}
          canWrite={canWrite}
          ui={WORKFLOW_WIDGET_UI_CONFIG}
          viewportBounds={widgetBounds ?? undefined}
        />
      </WorkflowUIConfigProvider>
    </div>
  )
}

type WorkflowEditorHeaderSelectorProps = {
  workspaceId?: string
  params?: Record<string, unknown> | null
}

const WorkflowEditorHeaderSelector = ({
  workspaceId,
  params,
}: WorkflowEditorHeaderSelectorProps) => {
  const { resolvedWorkflowId } = useWorkflowWidgetState({
    workspaceId,
    params,
  })
  const actions = useWidgetConfigRuntimeActions()
  const handleWorkflowChange = (workflowId: string) => {
    actions.patchWidgetLinkedParams?.({ workflowId })
  }

  return (
    <WorkflowDropdown
      workspaceId={workspaceId}
      value={resolvedWorkflowId}
      onChange={handleWorkflowChange}
    />
  )
}

export const workflowEditorWidget: DashboardWidgetDefinition = {
  contract: workflowEditorWidgetContract,
  icon: Workflow,
  component: (props) => <WorkflowEditorWidgetBody {...props} />,
  renderHeader: ({ channelId, widget, context, panelId }) => {
    const widgetKey = widget?.key ?? 'editor_workflow'
    const toolbarScopeId = readWorkflowToolbarScopeId(widgetKey, panelId)
    const canWrite = context?.canWrite !== false

    return {
      left: (
        <WorkflowToolbar
          workspaceId={context?.workspaceId}
          toolbarScopeId={toolbarScopeId}
          canWrite={canWrite}
        />
      ),
      center: (
        <WorkflowEditorHeaderSelector workspaceId={context?.workspaceId} params={widget?.params} />
      ),
      right: (
        <WorkflowWidgetControlBar
          workspaceId={context?.workspaceId}
          params={widget?.params}
          channelId={channelId}
          canWrite={canWrite}
        />
      ),
    }
  },
}
