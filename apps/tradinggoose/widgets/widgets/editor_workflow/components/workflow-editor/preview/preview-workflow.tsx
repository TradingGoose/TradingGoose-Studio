'use client'

import { useMemo, useState } from 'react'
import {
  Background,
  ConnectionLineType,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { cn } from '@/lib/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import type { PreviewDiffOperation } from './preview-diff'
import { WorkflowEdge } from '@/widgets/widgets/editor_workflow/components/workflow-edge/workflow-edge'
import { PreviewNode } from './preview-node'
import { adaptPreviewPayloadToCanvas } from './preview-payload-adapter'
import { PreviewSubflow } from './preview-subflow'
import { ReadOnlyNodeEditorPanel } from './read-only-node-editor-panel'

interface PreviewWorkflowProps {
  workflowState: WorkflowState
  className?: string
  height?: string | number
  width?: string | number
  isPannable?: boolean
  defaultPosition?: { x: number; y: number }
  defaultZoom?: number
  fitPadding?: number
  showInspector?: boolean
  onNodeClick?: (blockId: string, mousePosition: { x: number; y: number }) => void
  framed?: boolean
  diffOperations?: PreviewDiffOperation[]
}

const previewNodeTypes: NodeTypes = {
  previewNode: PreviewNode,
  subflowNode: PreviewSubflow,
}

const previewEdgeTypes: EdgeTypes = {
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}

export function PreviewWorkflow({
  workflowState,
  className,
  height = '100%',
  width = '100%',
  isPannable = false,
  defaultPosition,
  defaultZoom = 0.8,
  fitPadding = 0.25,
  showInspector = true,
  onNodeClick,
  framed = true,
  diffOperations,
}: PreviewWorkflowProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const { nodes, edges } = useMemo(() => {
    return diffOperations === undefined
      ? adaptPreviewPayloadToCanvas(workflowState)
      : adaptPreviewPayloadToCanvas(workflowState, { operations: diffOperations })
  }, [diffOperations, workflowState])

  return (
    <ReactFlowProvider>
      <div
        style={{ height, width }}
        className={cn(
          framed ? 'flex overflow-hidden rounded-md border border-border/60' : 'flex h-full w-full',
          className
        )}
      >
        <div className='min-h-0 min-w-0 flex-1'>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={previewNodeTypes}
            edgeTypes={previewEdgeTypes}
            connectionLineType={ConnectionLineType.Bezier}
            fitView
            fitViewOptions={{ padding: fitPadding }}
            panOnScroll={false}
            panOnDrag={isPannable}
            zoomOnScroll={false}
            draggable={false}
            defaultViewport={{
              x: defaultPosition?.x ?? 0,
              y: defaultPosition?.y ?? 0,
              zoom: defaultZoom,
            }}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            elementsSelectable={showInspector}
            nodesDraggable={false}
            nodesConnectable={false}
            style={{
              backgroundColor: 'transparent',
            }}
            className='xyflow-theme'
            onNodeClick={(event, node) => {
              setSelectedNodeId(node.id)
              onNodeClick?.(node.id, { x: event.clientX, y: event.clientY })
            }}
          >
            <Background bgColor='transparent' color='hsl(var(--workflow-dots))' size={4} gap={40} />
          </ReactFlow>
        </div>

        {showInspector && (
          <ReadOnlyNodeEditorPanel selectedNodeId={selectedNodeId} workflowState={workflowState} />
        )}
      </div>
    </ReactFlowProvider>
  )
}
