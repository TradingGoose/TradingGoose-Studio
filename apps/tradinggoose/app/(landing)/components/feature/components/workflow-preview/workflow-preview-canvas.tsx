'use client'

import { useCallback, useMemo } from 'react'
import { Minus, Plus } from 'lucide-react'
import {
  Background,
  ConnectionLineType,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { WorkflowEdge } from '@/widgets/widgets/editor_workflow/components/workflow-edge/workflow-edge'
import { PreviewNode } from '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-node'
import { adaptPreviewPayloadToCanvas } from '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-payload-adapter'
import { PreviewSubflow } from '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-subflow'

const previewNodeTypesImport: NodeTypes = {
  previewNode: PreviewNode,
  subflowNode: PreviewSubflow,
}

const previewEdgeTypesImport: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}

const PREVIEW_CANVAS_EXTENT: [[number, number], [number, number]] = [
  [-1_000_000, -1_000_000],
  [1_000_000, 1_000_000],
]

const PREVIEW_FIT_PADDING = 0.12

function WorkflowPreviewControls() {
  const { zoomIn, zoomOut } = useReactFlow()
  const zoom = useStore((state: { transform?: number[]; viewport?: { zoom?: number } }) =>
    Array.isArray(state.transform) ? state.transform[2] : state.viewport?.zoom
  )
  const currentZoom = Math.round(((zoom as number) || 1) * 100)

  return (
    <div className='pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center'>
      <div className='pointer-events-auto flex items-center gap-1 rounded-md border bg-card p-1 shadow-xs'>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => zoomOut({ duration: 200 })}
          disabled={currentZoom <= 10}
          className='h-7 w-7 rounded-sm hover:bg-background disabled:cursor-not-allowed disabled:opacity-50'
          aria-label='Zoom out workflow preview'
        >
          <Minus className='h-3 w-3' />
        </Button>
        <div className='flex w-12 items-center justify-center font-medium text-muted-foreground text-sm'>
          {currentZoom}%
        </div>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => zoomIn({ duration: 200 })}
          disabled={currentZoom >= 130}
          className='h-7 w-7 rounded-sm hover:bg-background disabled:cursor-not-allowed disabled:opacity-50'
          aria-label='Zoom in workflow preview'
        >
          <Plus className='h-3 w-3' />
        </Button>
      </div>
    </div>
  )
}

type WorkflowPreviewCanvasProps = {
  workflowKey: string
  workflowState: WorkflowState
  className?: string
}

type WorkflowPreviewFlowProps = Omit<WorkflowPreviewCanvasProps, 'workflowKey'>

function WorkflowPreviewFlow({ workflowState, className }: WorkflowPreviewFlowProps) {
  const nodeTypes = useMemo(() => previewNodeTypesImport, [])
  const edgeTypes = useMemo(() => previewEdgeTypesImport, [])
  const { nodes, edges } = useMemo(() => adaptPreviewPayloadToCanvas(workflowState), [workflowState])

  const onInit = useCallback((instance: any) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        instance.fitView({ padding: PREVIEW_FIT_PADDING })
      })
    })
  }, [])

  return (
    <div className={cn('workflow-container h-full w-full', className)}>
      <ReactFlow
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineType={ConnectionLineType.Bezier}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: PREVIEW_FIT_PADDING }}
        elementsSelectable
        selectNodesOnDrag={false}
        nodesDraggable
        nodesConnectable={false}
        panOnScroll
        zoomOnDoubleClick={false}
        zoomOnPinch
        minZoom={0.05}
        maxZoom={1.3}
        translateExtent={PREVIEW_CANVAS_EXTENT}
        nodeExtent={PREVIEW_CANVAS_EXTENT}
        noWheelClassName='allow-scroll'
        proOptions={{ hideAttribution: true }}
        className='h-full w-full'
        style={{
          backgroundColor: 'transparent',
        }}
      >
        <Background bgColor='transparent' color='hsl(var(--workflow-dots))' size={4} gap={40} />
        <WorkflowPreviewControls />
      </ReactFlow>
    </div>
  )
}

export function WorkflowPreviewCanvas({
  workflowKey,
  workflowState,
  className,
}: WorkflowPreviewCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowPreviewFlow
        key={workflowKey}
        workflowState={workflowState}
        className={className}
      />
    </ReactFlowProvider>
  )
}
