'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import ReactFlow, { Background, ConnectionLineType, type Node, ReactFlowProvider } from 'reactflow'
import 'reactflow/dist/style.css'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks'
import { useWorkflowStore, WorkflowStoreProvider } from '@/stores/workflows/workflow/store-client'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  workflowEdgeTypes as importedEdgeTypes,
  workflowNodeTypes as importedNodeTypes,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/block-registry'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

// Stable references outside the component prevent ReactFlow warning #002.
const nodeTypes = importedNodeTypes
const edgeTypes = importedEdgeTypes

const LANDING_WORKSPACE_ID = 'landing-preview'
const LANDING_WORKFLOW_ID = 'landing-workflow'
const LANDING_CHANNEL_ID = 'landing-workflow-preview'

function buildPreviewNodes(workflowState: WorkflowState): Node[] {
  return Object.values(workflowState.blocks).flatMap((block) => {
    const config = getBlock(block.type)
    if (!config) return []

    return [
      {
        id: block.id,
        type: 'workflowBlock',
        position: block.position,
        dragHandle: '.workflow-drag-handle',
        data: {
          type: block.type,
          config,
          name: block.name,
          readOnly: true,
          isPreview: true,
          subBlockValues: block.subBlocks,
          blockState: block,
          isActive: false,
          isPending: false,
        },
      } satisfies Node,
    ]
  })
}

/**
 * Hydrate the channel-scoped workflow store so the WorkflowBlock component
 * can look up its own block (needed for updateBlockLayoutMetrics, etc.).
 */
function useHydrateStore(workflowState: WorkflowState) {
  const replaceWorkflowState = useWorkflowStore((s) => s.replaceWorkflowState)
  const hydrated = useRef(false)

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true
      replaceWorkflowState(workflowState, { updateLastSaved: false })
    }
  }, [workflowState, replaceWorkflowState])
}

function WorkflowPreviewFlow({ workflowState, className }: WorkflowPreviewCanvasProps) {
  useHydrateStore(workflowState)

  const defaultNodes = useMemo(() => buildPreviewNodes(workflowState), [workflowState])

  // Use the raw edges from the workflow state directly as defaultEdges
  const defaultEdges = useMemo(
    () =>
      workflowState.edges.map((edge) => ({
        ...edge,
        type: edge.type || 'workflowEdge',
      })),
    [workflowState]
  )

  const onInit = useCallback((instance: any) => {
    // Double rAF to match the real editor — ensures nodes are measured first
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        instance.fitView({ padding: 0.18 })
      })
    })
  }, [])

  return (
    <div className={cn('workflow-container h-full w-full', className)}>
      <ReactFlow
        defaultNodes={defaultNodes}
        defaultEdges={defaultEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineType={ConnectionLineType.Bezier}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        zoomOnPinch={false}
        panOnScroll={false}
        panOnDrag={false}
        preventScrolling={false}
        minZoom={0.55}
        maxZoom={1.25}
        proOptions={{ hideAttribution: true }}
        className='h-full w-full'
      >
        <Background color='hsl(var(--workflow-dots))' size={4} gap={40} />
      </ReactFlow>
    </div>
  )
}

type WorkflowPreviewCanvasProps = {
  workflowState: WorkflowState
  className?: string
}

export function WorkflowPreviewCanvas({ workflowState, className }: WorkflowPreviewCanvasProps) {
  return (
    <WorkflowRouteProvider
      workspaceId={LANDING_WORKSPACE_ID}
      workflowId={LANDING_WORKFLOW_ID}
      channelId={LANDING_CHANNEL_ID}
    >
      <WorkflowStoreProvider channelId={LANDING_CHANNEL_ID} workflowId={LANDING_WORKFLOW_ID}>
        <ReactFlowProvider>
          <WorkflowPreviewFlow workflowState={workflowState} className={className} />
        </ReactFlowProvider>
      </WorkflowStoreProvider>
    </WorkflowRouteProvider>
  )
}
