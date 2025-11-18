'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Workflow } from 'lucide-react'
import { shallow } from 'zustand/shallow'
import { LoadingAgent } from '@/components/ui/loading-agent'
import WorkflowEditorApp from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-editor-app'
import type { WorkflowUIConfig } from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow'
import {
  WorkflowWidgetControlBar,
  getWorkflowWidgetChannelId,
} from '@/widgets/components/workflow-controlbar'
import { WorkflowToolbar } from '@/widgets/components/workflow-toolbar'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useWorkflowRegistry, hasWorkflowsInitiallyLoaded } from '@/stores/workflows/registry/store'
import { isPairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'

const WORKFLOW_WIDGET_UI_CONFIG: WorkflowUIConfig = {
  controlBar: false,
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
  const workspaceId = context?.workspaceId
  const resolvedPairColor = isPairColor(pairColor) ? pairColor : 'gray'
  const widgetKey = widget?.key ?? 'workflow-editor'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const { workflows, isLoading, loadWorkflows, setActiveWorkflow } = useWorkflowRegistry(
    (state) => ({
      workflows: state.workflows,
      isLoading: state.isLoading,
      loadWorkflows: state.loadWorkflows,
      setActiveWorkflow: state.setActiveWorkflow,
    }),
    shallow
  )
  const [hasLoadedWorkflows, setHasLoadedWorkflows] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
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

  const requestedWorkflowId =
    resolvedPairColor === 'gray' && typeof params === 'object' && params && 'workflowId' in params
      ? String(params.workflowId)
      : null

  const channelId = useMemo(
    () => getWorkflowWidgetChannelId(resolvedPairColor, widgetKey, panelId),
    [resolvedPairColor, widgetKey, panelId]
  )

  const activeWorkflowIdForChannel = useWorkflowRegistry((state) =>
    typeof state.getActiveWorkflowId === 'function'
      ? state.getActiveWorkflowId(channelId)
      : state.activeWorkflowId
  )

  const workspaceHasWorkflows = useMemo(() => {
    if (!workspaceId) {
      return false
    }
    return Object.values(workflows ?? {}).some((workflow) => workflow?.workspaceId === workspaceId)
  }, [workflows, workspaceId])

  useEffect(() => {
    setLoadError(null)

    if (!workspaceId) {
      setHasLoadedWorkflows(true)
      return
    }

    if (workspaceHasWorkflows || hasWorkflowsInitiallyLoaded()) {
      setHasLoadedWorkflows(true)
      return
    }

    let cancelled = false
    setHasLoadedWorkflows(false)

    loadWorkflows(workspaceId)
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load workflows for dashboard widget', error)
          setLoadError('Unable to load workflows')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHasLoadedWorkflows(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, workspaceHasWorkflows, loadWorkflows])

  const workflowIds = useMemo(() => Object.keys(workflows ?? {}), [workflows])

  const resolvedWorkflowId = useMemo(() => {
    if (!hasLoadedWorkflows || workflowIds.length === 0) {
      return null
    }

    const pairWorkflowId =
      resolvedPairColor !== 'gray' && pairContext.workflowId && workflows[pairContext.workflowId]
        ? pairContext.workflowId
        : null

    if (pairWorkflowId) {
      return pairWorkflowId
    }

    if (requestedWorkflowId && workflows[requestedWorkflowId]) {
      return requestedWorkflowId
    }

    return workflowIds[0]
  }, [hasLoadedWorkflows, workflowIds, pairContext.workflowId, workflows, requestedWorkflowId, resolvedPairColor])

  useEffect(() => {
    if (!resolvedWorkflowId || activeWorkflowIdForChannel === resolvedWorkflowId) {
      return
    }

    let cancelled = false

    setActiveWorkflow({ workflowId: resolvedWorkflowId, channelId })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to activate workflow inside widget', error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [resolvedWorkflowId, activeWorkflowIdForChannel, setActiveWorkflow, channelId])

  const currentPairWorkflowId = pairContext.workflowId
  const currentTicker = pairContext.ticker

  useEffect(() => {
    if (resolvedPairColor === 'gray' || !resolvedWorkflowId) {
      return
    }

    if (currentPairWorkflowId === resolvedWorkflowId) {
      return
    }

    setPairContext(resolvedPairColor, {
      workflowId: resolvedWorkflowId,
      ticker: currentTicker,
      channelId,
    })
  }, [
    resolvedPairColor,
    resolvedWorkflowId,
    currentPairWorkflowId,
    currentTicker,
    setPairContext,
    channelId,
  ])

  useEffect(() => {
    if (resolvedPairColor !== 'gray') {
      return
    }

    if (!resolvedWorkflowId || !onWidgetParamsChange) {
      return
    }

    if (requestedWorkflowId === resolvedWorkflowId) {
      return
    }

    onWidgetParamsChange({ workflowId: resolvedWorkflowId })
  }, [resolvedPairColor, resolvedWorkflowId, requestedWorkflowId, onWidgetParamsChange])

  if (!workspaceId) {
    return (
      <WidgetStateMessage message='Select a workspace to load workflows.' />
    )
  }

  if (loadError) {
    return <WidgetStateMessage message={loadError} />
  }

  if (
    !hasLoadedWorkflows ||
    isLoading ||
    !resolvedWorkflowId ||
    activeWorkflowIdForChannel !== resolvedWorkflowId
  ) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))]'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (workflowIds.length === 0) {
    return <WidgetStateMessage message='No workflows available in this workspace.' />
  }

  return (
    <div
      ref={setContainerRef}
      className='relative flex h-full w-full overflow-hidden bg-[hsl(var(--workflow-background))]'
    >
      <WorkflowEditorApp
        workspaceId={workspaceId}
        workflowId={resolvedWorkflowId}
        channelId={channelId}
        ui={WORKFLOW_WIDGET_UI_CONFIG}
        viewportBounds={widgetBounds ?? undefined}
      />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center bg-[hsl(var(--workflow-background))] px-4 text-center text-xs text-muted-foreground'>
    {message}
  </div>
)

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

    const workflowId =
      widget && widget.params && typeof widget.params === 'object' && 'workflowId' in widget.params
        ? (widget.params.workflowId as string)
        : 'default'

    return {
      left: [
        <WorkflowToolbar
          key='workflow-toolbar'
          workspaceId={context?.workspaceId}
          channelId={channelId}
        />,
        <span key='workflow-label' className='text-xs'>Workflow: {workflowId}</span>,
      ],
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
