'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import ReactFlow, {
  applyNodeChanges,
  Background,
  ConnectionLineType,
  type Node,
  type NodeChange,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BlockConfig } from '@/blocks/types'
import { useWorkflowStore, WorkflowStoreProvider } from '@/stores/workflows/workflow/store-client'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { isBlockProtected } from '@/stores/workflows/workflow/utils'
import {
  getBlockConfigFromCache,
  workflowEdgeTypes as importedEdgeTypes,
  workflowNodeTypes as importedNodeTypes,
  resolveCanvasNodeDescriptor,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/block-registry'
import { resizeContainerNodes } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/node-position-utils'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const nodeTypes = importedNodeTypes
const edgeTypes = importedEdgeTypes

const LANDING_WORKSPACE_ID = 'landing-preview'
const LANDING_WORKFLOW_ID = 'landing-workflow'
const LANDING_CHANNEL_ID = 'landing-workflow-preview'
const PREVIEW_CANVAS_EXTENT: [[number, number], [number, number]] = [
  [-1_000_000, -1_000_000],
  [1_000_000, 1_000_000],
]
const PREVIEW_FIT_PADDING = 0.12

function getLoopModeLabel(workflowState: WorkflowState, block: BlockState) {
  const loopConfig = workflowState.loops[block.id]
  const loopType = loopConfig?.loopType ?? block.data?.loopType ?? 'for'

  if (loopType === 'forEach') {
    return 'For each item'
  }

  if (loopType === 'while') {
    return 'While condition'
  }

  if (loopType === 'doWhile') {
    return 'Do while condition'
  }

  return 'Fixed iteration loop'
}

function getLoopSummaryLabel(workflowState: WorkflowState, block: BlockState) {
  const iterations = workflowState.loops[block.id]?.iterations ?? block.data?.count
  return typeof iterations === 'number' ? `${iterations} iterations` : undefined
}

function getParallelModeLabel(workflowState: WorkflowState, block: BlockState) {
  const parallelType = workflowState.parallels[block.id]?.parallelType ?? block.data?.parallelType
  return parallelType === 'collection' ? 'Collection fan-out' : 'Fixed branch fan-out'
}

function getParallelSummaryLabel(workflowState: WorkflowState, block: BlockState) {
  const count = workflowState.parallels[block.id]?.count ?? block.data?.count
  return typeof count === 'number' ? `${count} branches` : undefined
}

function buildPreviewNodes(workflowState: WorkflowState): Node[] {
  const blockConfigCache = new Map<string, BlockConfig | undefined>()

  return Object.values(workflowState.blocks).flatMap((block) => {
    const descriptor = resolveCanvasNodeDescriptor({
      block,
      isActive: false,
      isPending: false,
      hasNestedError: false,
      resolveBlockConfig: (type) => getBlockConfigFromCache(blockConfigCache, type),
    })

    if (!descriptor) return []

    return [
      {
        id: block.id,
        type: descriptor.nodeType,
        position: block.position,
        parentId: block.data?.parentId,
        draggable: !isBlockProtected(block.id, workflowState.blocks),
        extent: block.data?.extent || undefined,
        width: descriptor.width,
        height: descriptor.height,
        data:
          descriptor.nodeType === 'workflowBlock'
            ? {
                ...descriptor.data,
                readOnly: true,
                isPreview: true,
                subBlockValues: block.subBlocks,
                blockState: block,
              }
            : {
                ...descriptor.data,
                enabled: block.enabled ?? true,
                isPreview: true,
                childCount: Object.values(workflowState.blocks).filter(
                  (candidate) => candidate.data?.parentId === block.id
                ).length,
                modeLabel:
                  block.type === 'loop'
                    ? getLoopModeLabel(workflowState, block)
                    : getParallelModeLabel(workflowState, block),
                summaryLabel:
                  block.type === 'loop'
                    ? getLoopSummaryLabel(workflowState, block)
                    : getParallelSummaryLabel(workflowState, block),
              },
      } satisfies Node,
    ]
  })
}

function buildPreviewEdges(workflowState: WorkflowState) {
  return workflowState.edges.map((edge) => ({
    ...edge,
    type: edge.type || 'workflowEdge',
  }))
}

function resizePreviewContainers(
  nodes: Node[],
  blocks: Record<string, BlockState>
): {
  nodes: Node[]
  blocks: Record<string, BlockState>
} {
  let nextNodes = nodes
  let nextBlocks = blocks
  let hasChanges = false

  const getNodes = () => nextNodes

  const updateNodeDimensions = (id: string, dimensions: { width: number; height: number }) => {
    const currentNode = nextNodes.find((node) => node.id === id)
    const currentBlock = nextBlocks[id]
    const currentWidth =
      (typeof currentNode?.data?.width === 'number' ? currentNode.data.width : undefined) ??
      currentBlock?.data?.width
    const currentHeight =
      (typeof currentNode?.data?.height === 'number' ? currentNode.data.height : undefined) ??
      currentBlock?.data?.height

    if (currentWidth === dimensions.width && currentHeight === dimensions.height) {
      return
    }

    hasChanges = true
    nextNodes = nextNodes.map((node) =>
      node.id === id
        ? {
            ...node,
            width: dimensions.width,
            height: dimensions.height,
            data: {
              ...node.data,
              width: dimensions.width,
              height: dimensions.height,
            },
          }
        : node
    )

    if (currentBlock) {
      nextBlocks = {
        ...nextBlocks,
        [id]: {
          ...currentBlock,
          data: {
            ...currentBlock.data,
            width: dimensions.width,
            height: dimensions.height,
          },
        },
      }
    }
  }

  resizeContainerNodes(getNodes, updateNodeDimensions, nextBlocks)

  return hasChanges ? { nodes: nextNodes, blocks: nextBlocks } : { nodes, blocks }
}

function useHydrateStore(workflowState: WorkflowState) {
  const replaceWorkflowState = useWorkflowStore((s) => s.replaceWorkflowState)

  useEffect(() => {
    replaceWorkflowState(workflowState, { updateLastSaved: false })
  }, [workflowState, replaceWorkflowState])
}

function WorkflowPreviewControls() {
  const { zoomIn, zoomOut } = useReactFlow()
  const zoom = useStore((state: any) =>
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
  const previewSeed = useMemo(() => {
    const initialBlocks = workflowState.blocks
    const initialNodes = buildPreviewNodes(workflowState)
    const resizedPreview = resizePreviewContainers(initialNodes, initialBlocks)

    return {
      blocks: resizedPreview.blocks,
      nodes: resizedPreview.nodes,
      edges: buildPreviewEdges(workflowState),
    }
  }, [workflowState])

  const [previewBlocks, setPreviewBlocks] = useState(previewSeed.blocks)
  const [nodes, setNodes] = useState(previewSeed.nodes)

  const hydratedWorkflowState = useMemo(
    () => ({
      ...workflowState,
      blocks: previewBlocks,
    }),
    [workflowState, previewBlocks]
  )

  useHydrateStore(hydratedWorkflowState)

  const edges = useMemo(() => previewSeed.edges, [previewSeed.edges])

  useEffect(() => {
    setPreviewBlocks(previewSeed.blocks)
    setNodes(previewSeed.nodes)
  }, [previewSeed.blocks, previewSeed.nodes])

  useEffect(() => {
    const resizedPreview = resizePreviewContainers(nodes, previewBlocks)

    if (resizedPreview.blocks !== previewBlocks) {
      setPreviewBlocks(resizedPreview.blocks)
    }

    if (resizedPreview.nodes !== nodes) {
      setNodes(resizedPreview.nodes)
    }
  }, [nodes, previewBlocks])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes))
  }, [])

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
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
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
        draggable={false}
        minZoom={0.05}
        maxZoom={1.3}
        translateExtent={PREVIEW_CANVAS_EXTENT}
        nodeExtent={PREVIEW_CANVAS_EXTENT}
        noWheelClassName='allow-scroll'
        autoPanOnNodeDrag
        proOptions={{ hideAttribution: true }}
        className='h-full w-full'
      >
        <Background color='hsl(var(--workflow-dots))' size={4} gap={40} />
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
    <WorkflowRouteProvider
      workspaceId={LANDING_WORKSPACE_ID}
      workflowId={LANDING_WORKFLOW_ID}
      channelId={LANDING_CHANNEL_ID}
    >
      <WorkflowStoreProvider channelId={LANDING_CHANNEL_ID} workflowId={LANDING_WORKFLOW_ID}>
        <ReactFlowProvider>
          <WorkflowPreviewFlow
            key={workflowKey}
            workflowState={workflowState}
            className={className}
          />
        </ReactFlowProvider>
      </WorkflowStoreProvider>
    </WorkflowRouteProvider>
  )
}
