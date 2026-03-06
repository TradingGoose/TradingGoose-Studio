'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  type Edge,
  type Node,
  useOnSelectionChange,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerUtils } from '@/lib/workflows/triggers'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getBlock } from '@/blocks'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useStreamCleanup } from '@/hooks/use-stream-cleanup'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'
import { useCurrentWorkflow } from '@/hooks/workflow'
import { useCopilotStore } from '@/stores/copilot/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { hasWorkflowsInitiallyLoaded, useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getUniqueBlockName } from '@/stores/workflows/utils'
import { isBlockProtected } from '@/stores/workflows/workflow/utils'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  useWorkflowStore,
} from '@/stores/workflows/workflow/store-client'
import { ControlBar } from '@/widgets/widgets/editor_workflow/components/control-bar/control-bar'
import { DiffControls } from '@/widgets/widgets/editor_workflow/components/diff-controls'
import { FloatingControls } from '@/widgets/widgets/editor_workflow/components/floating-controls/floating-controls'
import { TrainingControls } from '@/widgets/widgets/editor_workflow/components/training-controls/training-controls'
import { TriggerList } from '@/widgets/widgets/editor_workflow/components/trigger-list/trigger-list'
import {
  TriggerWarningDialog,
  TriggerWarningType,
} from '@/widgets/widgets/editor_workflow/components/trigger-warning-dialog'
import { WorkflowConnectionLine } from '@/widgets/widgets/editor_workflow/components/workflow-edge/workflow-connection-line'
import {
  getBlockConfigFromCache,
  resolveCanvasNodeDescriptor,
  workflowEdgeTypes,
  workflowNodeTypes,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/block-registry'
import { createConnectionEdge } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/connection-manager'
import { deriveCanvasEdges } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/derive-canvas-edges'
import {
  deriveCanvasNodes,
  getStableBlocksHash,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/derive-canvas-nodes'
import {
  getNodeAbsolutePosition,
  getNodeSourceAnchorPosition,
  isPointInContainerNode,
  resizeContainerNodes,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/node-position-utils'
import {
  applyContainerHighlight,
  buildAutoConnectEdgesForContainerDrop,
  clearContainerHighlights,
  findBestContainerForDraggedNode,
  updateNodeParentForCanvas,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/parenting-manager'
import {
  createNodeIndex,
  deriveEdgesWithSelection,
  getSelectedEdgeInfo,
  type SelectedEdgeInfo,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/selection-manager'
import {
  emitSkipEdgeRecording,
  emitWorkflowRecordMove,
  emitWorkflowRecordParentUpdate,
  type RemoveFromSubflowPayload,
  subscribeRemoveFromSubflow,
  subscribeUpdateSubBlockValue,
  type UpdateSubBlockValuePayload,
} from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus'
import { NodeEditorPanel } from '@/widgets/widgets/editor_workflow/components/workflow-editor/panel/node-editor-panel'
import {
  registerToolbarAddBlockHandler,
  type ToolbarAddBlockRequest,
} from '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-dispatcher'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('Workflow')

// Memoized ReactFlow props to prevent unnecessary re-renders
const defaultEdgeOptions = { type: 'custom' }
const connectionLineStyle = {
  stroke: '#94a3b8',
  strokeWidth: 2,
  strokeDasharray: '5,5',
}
const snapGrid: [number, number] = [20, 20]

interface BlockData {
  id: string
  type: string
  position: { x: number; y: number }
  distance: number
}

type WorkflowViewportBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type WorkflowCanvasUIConfig = {
  controlBar?: boolean
  floatingControls?: boolean
  trainingControls?: boolean
  forceTrainingControls?: boolean
  diffControls?: boolean
  triggerList?: boolean
}

const defaultUIConfig: Required<WorkflowCanvasUIConfig> = {
  controlBar: false,
  floatingControls: false,
  trainingControls: false,
  forceTrainingControls: false,
  diffControls: true,
  triggerList: true,
}

type WorkflowCanvasProps = {
  ui?: WorkflowCanvasUIConfig
  disableNavigation?: boolean
  channelId?: string
  toolbarScopeId?: string
  viewportBounds?: WorkflowViewportBounds
}

const WorkflowCanvas = React.memo(
  ({
    ui,
    disableNavigation = false,
    channelId,
    toolbarScopeId,
    viewportBounds,
  }: WorkflowCanvasProps) => {
    const uiConfig = useMemo(() => ({ ...defaultUIConfig, ...ui }), [ui])
    // State
    const [isWorkflowReady, setIsWorkflowReady] = useState(false)

    // State for tracking node dragging
    const [potentialParentId, setPotentialParentId] = useState<string | null>(null)
    // State for tracking validation errors
    // Use a function initializer to ensure the Set is only created once
    const [nestedSubflowErrors, setNestedSubflowErrors] = useState<Set<string>>(() => new Set())
    // Enhanced edge selection with parent context and unique identifier
    const [selectedEdgeInfo, setSelectedEdgeInfo] = useState<SelectedEdgeInfo | null>(null)
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const handleSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => {
      setSelectedNodeId(nodes.length === 1 ? nodes[0].id : null)
    }, [])

    useOnSelectionChange({
      onChange: handleSelectionChange,
    })

    // State for trigger warning dialog
    const [triggerWarning, setTriggerWarning] = useState<{
      open: boolean
      triggerName: string
      type: TriggerWarningType
    }>({
      open: false,
      triggerName: '',
      type: TriggerWarningType.DUPLICATE_TRIGGER,
    })

    // Hooks
    const router = useRouter()
    const { workspaceId, workflowId } = useWorkflowRoute()
    const resolvedChannelId = useMemo(() => channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID, [channelId])
    const reactFlowId = useMemo(() => `workflow-${resolvedChannelId}`, [resolvedChannelId])
    const { project, getNodes, screenToFlowPosition } = useReactFlow()

    const getViewportCenterCoordinates = useCallback(() => {
      if (viewportBounds) {
        return {
          x: viewportBounds.x + viewportBounds.width / 2,
          y: viewportBounds.y + viewportBounds.height / 2,
        }
      }

      if (typeof window !== 'undefined') {
        return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      }

      return { x: 0, y: 0 }
    }, [viewportBounds])

    const projectViewportCenter = useCallback(() => {
      const center = getViewportCenterCoordinates()
      return typeof screenToFlowPosition === 'function'
        ? screenToFlowPosition(center)
        : project(center)
    }, [project, screenToFlowPosition, getViewportCenterCoordinates])

    const containerHeightClass = viewportBounds ? 'h-full' : 'h-screen'

    const effectiveWorkflowId = workflowId ?? null
    const shouldHandleNavigation = !disableNavigation

    const workflows = useWorkflowRegistry((state) => state.workflows)
    const setActiveWorkflow = useWorkflowRegistry((state) => state.setActiveWorkflow)
    const activeWorkflowId = useWorkflowRegistry((state) =>
      state.getActiveWorkflowId(resolvedChannelId)
    )
    const hydration = useWorkflowRegistry((state) => state.getHydration(resolvedChannelId))
    const isChannelHydrating = useWorkflowRegistry((state) =>
      state.isChannelHydrating(resolvedChannelId)
    )

    // Use the clean abstraction for current workflow state
    const currentWorkflow = useCurrentWorkflow()

    const {
      updateNodeDimensions,
      updateBlockPosition: storeUpdateBlockPosition,
      setDragStartPosition,
      getDragStartPosition,
    } = useWorkflowStore()

    // Get copilot cleanup function
    const copilotCleanup = useCopilotStore((state) => state.cleanup)

    // Handle copilot stream cleanup on page unload and component unmount
    useStreamCleanup(copilotCleanup)

    // Extract workflow data from the abstraction
    const { blocks, edges, isDiffMode } = currentWorkflow
    const hasLockedBlocks = useMemo(
      () => Object.values(blocks).some((block) => Boolean(block.locked)),
      [blocks]
    )

    // Check if workflow is empty (no blocks)
    const isWorkflowEmpty = useMemo(() => {
      return Object.keys(blocks).length === 0
    }, [blocks])

    // Get diff analysis for edge reconstruction
    const { diffAnalysis, isShowingDiff, isDiffReady } = useWorkflowDiffStore()

    const edgesForDisplay = useMemo(() => {
      return deriveCanvasEdges({
        edges,
        isShowingDiff,
        isDiffReady,
        diffAnalysis,
        blocks,
      })
    }, [edges, isShowingDiff, isDiffReady, diffAnalysis, blocks])

    // User permissions - get current user's specific permissions from context
    const userPermissions = useUserPermissionsContext()

    // Create diff-aware permissions that disable editing when in diff mode
    const effectivePermissions = useMemo(() => {
      if (isDiffMode) {
        // In diff mode, disable all editing regardless of user permissions
        return {
          ...userPermissions,
          canEdit: false,
          canAdmin: false,
          // Keep canRead true so users can still view content
          canRead: userPermissions.canRead,
        }
      }
      return userPermissions
    }, [userPermissions, isDiffMode])

    // Workspace permissions - get all users and their permissions for this workspace
    const { permissions: workspacePermissions, error: permissionsError } = useWorkspacePermissions(
      workspaceId || null
    )

    // Store access
    const {
      collaborativeAddBlock: addBlock,
      collaborativeAddEdge: addEdge,
      collaborativeRemoveEdge: removeEdge,
      collaborativeUpdateBlockPosition,
      collaborativeUpdateParentId: updateParentId,
      collaborativeSetSubblockValue,
      undo,
      redo,
    } = useCollaborativeWorkflow()

    // Execution and debug mode state
    const { activeBlockIds, pendingBlocks, isDebugging } = useExecutionStore()
    const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

    // Helper function to validate workflow for nested subflows
    const validateNestedSubflows = useCallback(() => {
      const errors = new Set<string>()

      Object.entries(blocks).forEach(([blockId, block]) => {
        // Check if this is a subflow block (loop or parallel)
        if (block.type === 'loop' || block.type === 'parallel') {
          // Check if it has a parent that is also a subflow block
          const parentId = block.data?.parentId
          if (parentId) {
            const parentBlock = blocks[parentId]
            if (parentBlock && (parentBlock.type === 'loop' || parentBlock.type === 'parallel')) {
              // This is a nested subflow - mark as error
              errors.add(blockId)
            }
          }
        }
      })

      setNestedSubflowErrors(errors)
      return errors.size === 0
    }, [blocks])

    // Log permissions when they load
    useEffect(() => {
      if (workspacePermissions) {
        logger.info('Workspace permissions loaded in workflow', {
          workspaceId,
          userCount: workspacePermissions.total,
          permissions: workspacePermissions.users.map((u) => ({
            email: u.email,
            permissions: u.permissionType,
          })),
        })
      }
    }, [workspacePermissions, workspaceId])

    // Log permissions errors
    useEffect(() => {
      if (permissionsError) {
        logger.error('Failed to load workspace permissions', {
          workspaceId,
          error: permissionsError,
        })
      }
    }, [permissionsError, workspaceId])

    const resizeLoopNodesWrapper = useCallback(() => {
      resizeContainerNodes(getNodes, updateNodeDimensions, blocks)
    }, [getNodes, updateNodeDimensions, blocks])

    const updateNodeParent = useCallback(
      (nodeId: string, newParentId: string | null, affectedEdges: Edge[] = []) => {
        const result = updateNodeParentForCanvas({
          nodeId,
          newParentId,
          blocks,
          getNodes,
          edgesForDisplay,
          affectedEdges,
          updateBlockPosition: collaborativeUpdateBlockPosition,
          updateParentId,
          updateNodeDimensions,
        })

        if (result?.changed) {
          if (!effectiveWorkflowId) {
            return result
          }

          emitWorkflowRecordParentUpdate({
            channelId: resolvedChannelId,
            workflowId: effectiveWorkflowId,
            blockId: nodeId,
            oldParentId: result.oldParentId || undefined,
            newParentId: result.newParentId || undefined,
            oldPosition: result.oldPosition,
            newPosition: result.newPosition,
            affectedEdges: result.affectedEdges.map((edge) => ({ ...edge })),
          })
        }

        return result
      },
      [
        blocks,
        getNodes,
        edgesForDisplay,
        collaborativeUpdateBlockPosition,
        updateParentId,
        updateNodeDimensions,
        resolvedChannelId,
        effectiveWorkflowId,
      ]
    )

    const getNodeAbsolutePositionWrapper = useCallback(
      (nodeId: string): { x: number; y: number } => {
        return getNodeAbsolutePosition(nodeId, getNodes, blocks)
      },
      [getNodes, blocks]
    )

    const isPointInLoopNodeWrapper = useCallback(
      (position: { x: number; y: number }) => {
        return isPointInContainerNode(position, getNodes, blocks)
      },
      [getNodes, blocks]
    )

    const getNodeAnchorPosition = useCallback(
      (nodeId: string): { x: number; y: number } => {
        return getNodeSourceAnchorPosition(nodeId, getNodes, blocks)
      },
      [getNodes, blocks]
    )

    // Auto-layout handler - now uses frontend auto layout for immediate updates
    const { data: session } = useSession()

    const handleAutoLayout = useCallback(async () => {
      if (Object.keys(blocks).length === 0) return

      try {
        // Use the shared auto layout utility for immediate frontend updates
        const { applyAutoLayoutAndUpdateStore } = await import(
          '@/widgets/widgets/editor_workflow/components/control-bar/auto-layout'
        )

        const result = await applyAutoLayoutAndUpdateStore({
          workflowId: activeWorkflowId!,
          channelId: resolvedChannelId,
          undoUserId: session?.user?.id,
        })

        if (result.success) {
          logger.info('Auto layout completed successfully')
        } else {
          logger.error('Auto layout failed:', result.error)
        }
      } catch (error) {
        logger.error('Auto layout error:', error)
      }
    }, [activeWorkflowId, blocks, resolvedChannelId])

    const debouncedAutoLayout = useCallback(() => {
      const debounceTimer = setTimeout(() => {
        handleAutoLayout()
      }, 250)

      return () => clearTimeout(debounceTimer)
    }, [handleAutoLayout])

    useEffect(() => {
      let cleanup: (() => void) | null = null

      const handleKeyDown = (event: KeyboardEvent) => {
        const activeElement = document.activeElement
        const isEditableElement =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.hasAttribute('contenteditable')

        if (isEditableElement) {
          return
        }

        if (event.shiftKey && event.key === 'L' && !event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          if (cleanup) cleanup()
          cleanup = debouncedAutoLayout()
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
          event.preventDefault()
          undo()
        } else if (
          (event.ctrlKey || event.metaKey) &&
          (event.key === 'Z' || (event.key === 'z' && event.shiftKey))
        ) {
          event.preventDefault()
          redo()
        }
      }

      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        if (cleanup) cleanup()
      }
    }, [debouncedAutoLayout, undo, redo])

    // Listen for explicit subflow detach actions from ActionBar
    useEffect(() => {
      if (!effectiveWorkflowId) {
        return
      }

      const handleRemoveFromSubflow = ({ blockId }: RemoveFromSubflowPayload) => {
        if (!blockId) return

        try {
          if (isBlockProtected(blockId, blocks)) {
            return
          }

          const currentBlock = blocks[blockId]
          const parentId = currentBlock?.data?.parentId

          if (!parentId) return

          // Find ALL edges connected to this block
          const edgesToRemove = edgesForDisplay.filter(
            (e) => e.source === blockId || e.target === blockId
          )

          // Set flag to skip individual edge recording for undo/redo
          emitSkipEdgeRecording({
            channelId: resolvedChannelId,
            workflowId: effectiveWorkflowId,
            skip: true,
          })

          // Remove edges first
          edgesToRemove.forEach((edge) => {
            removeEdge(edge.id)
          })

          // Then update parent relationship
          updateNodeParent(blockId, null, edgesToRemove)

          emitSkipEdgeRecording({
            channelId: resolvedChannelId,
            workflowId: effectiveWorkflowId,
            skip: false,
          })
        } catch (err) {
          logger.error('Failed to remove from subflow', { err })
        }
      }

      return subscribeRemoveFromSubflow(
        { channelId: resolvedChannelId, workflowId: effectiveWorkflowId },
        handleRemoveFromSubflow
      )
    }, [
      effectiveWorkflowId,
      resolvedChannelId,
      blocks,
      updateNodeParent,
      removeEdge,
      edgesForDisplay,
    ])

    // Handle drops
    const findClosestOutput = useCallback(
      (newNodePosition: { x: number; y: number }): BlockData | null => {
        // Determine if drop is inside a container; if not, exclude child nodes from candidates
        const containerAtPoint = isPointInLoopNodeWrapper(newNodePosition)
        const nodeIndex = new Map(getNodes().map((n) => [n.id, n]))

        const candidates = Object.entries(blocks)
          .filter(([id, block]) => {
            if (!block.enabled) return false
            const node = nodeIndex.get(id)
            if (!node) return false

            // If dropping outside containers, ignore blocks that are inside a container
            if (!containerAtPoint && blocks[id]?.data?.parentId) return false
            return true
          })
          .map(([id, block]) => {
            const anchor = getNodeAnchorPosition(id)
            const distance = Math.sqrt(
              (anchor.x - newNodePosition.x) ** 2 + (anchor.y - newNodePosition.y) ** 2
            )
            return {
              id,
              type: block.type,
              position: anchor,
              distance,
            }
          })
          .sort((a, b) => a.distance - b.distance)

        return candidates[0] || null
      },
      [blocks, getNodes, getNodeAnchorPosition, isPointInLoopNodeWrapper]
    )

    // Determine the appropriate source handle based on block type
    const determineSourceHandle = useCallback((block: { id: string; type: string }) => {
      // Default source handle
      let sourceHandle = 'source'

      // For condition blocks, use the first condition handle
      if (block.type === 'condition') {
        // Get just the first condition handle from the DOM
        const conditionHandles = document.querySelectorAll(
          `[data-nodeid^="${block.id}"][data-handleid^="condition-"]`
        )
        if (conditionHandles.length > 0) {
          // Extract the full handle ID from the first condition handle
          const handleId = conditionHandles[0].getAttribute('data-handleid')
          if (handleId) {
            sourceHandle = handleId
          }
        }
      }
      // For loop and parallel nodes, use their end source handle
      else if (block.type === 'loop') {
        sourceHandle = 'loop-end-source'
      } else if (block.type === 'parallel') {
        sourceHandle = 'parallel-end-source'
      }

      return sourceHandle
    }, [])

    // Listen for toolbar block click events
    useEffect(() => {
      const handleAddBlockFromToolbar = (detail: ToolbarAddBlockRequest) => {
        // Check if user has permission to interact with blocks
        if (!effectivePermissions.canEdit) {
          return
        }

        const { type, enableTriggerMode } = detail || {}

        if (!type) return
        if (type === 'connectionBlock') return

        // Special handling for container nodes (loop or parallel)
        if (type === 'loop' || type === 'parallel') {
          // Create a unique ID and name for the container
          const id = crypto.randomUUID()

          const baseName = type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, blocks)

          // Calculate the center position of the viewport
          const centerPosition = projectViewportCenter()

          // Auto-connect logic for container nodes
          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          let autoConnectEdge
          if (isAutoConnectEnabled) {
            const closestBlock = findClosestOutput(centerPosition)
            if (closestBlock) {
              // Get appropriate source handle
              const sourceHandle = determineSourceHandle(closestBlock)

              autoConnectEdge = {
                id: crypto.randomUUID(),
                source: closestBlock.id,
                target: id,
                sourceHandle,
                targetHandle: 'target',
                type: 'workflowEdge',
              }
            }
          }

          // Add the container node directly to canvas with default dimensions and auto-connect edge
          addBlock(
            id,
            type,
            name,
            centerPosition,
            {
              width: 500,
              height: 300,
              type: 'subflowNode',
            },
            undefined,
            undefined,
            autoConnectEdge
          )

          return
        }

        const blockConfig = getBlock(type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { type })
          return
        }

        // Calculate the center position of the viewport
        const centerPosition = projectViewportCenter()

        // Create a new block with a unique ID
        const id = crypto.randomUUID()
        // Prefer semantic default names for triggers; then ensure unique numbering centrally
        const defaultTriggerName = TriggerUtils.getDefaultTriggerName(type)
        const baseName = defaultTriggerName || blockConfig.name
        const name = getUniqueBlockName(baseName, blocks)

        // Auto-connect logic
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        let autoConnectEdge
        if (isAutoConnectEnabled && blockConfig.category !== 'triggers') {
          const closestBlock = findClosestOutput(centerPosition)
          logger.info('Closest block found:', closestBlock)
          if (closestBlock) {
            // Get appropriate source handle
            const sourceHandle = determineSourceHandle(closestBlock)

            autoConnectEdge = {
              id: crypto.randomUUID(),
              source: closestBlock.id,
              target: id,
              sourceHandle,
              targetHandle: 'target',
              type: 'workflowEdge',
            }
            logger.info('Auto-connect edge created:', autoConnectEdge)
          }
        }

        // Centralized trigger constraints
        const additionIssue = TriggerUtils.getTriggerAdditionIssue(blocks, type)
        if (additionIssue) {
          setTriggerWarning({
            open: true,
            triggerName: additionIssue.triggerName,
            type: TriggerWarningType.DUPLICATE_TRIGGER,
          })
          return
        }

        // Add the block to the workflow with auto-connect edge
        // Enable trigger mode if this is a trigger-capable block from the triggers tab
        addBlock(
          id,
          type,
          name,
          centerPosition,
          undefined,
          undefined,
          undefined,
          autoConnectEdge,
          enableTriggerMode
        )
      }

      if (!toolbarScopeId) {
        return
      }

      return registerToolbarAddBlockHandler(toolbarScopeId, handleAddBlockFromToolbar)
    }, [
      blocks,
      addBlock,
      findClosestOutput,
      determineSourceHandle,
      effectivePermissions.canEdit,
      setTriggerWarning,
      projectViewportCenter,
      toolbarScopeId,
    ])

    // Handler for trigger selection from list
    const handleTriggerSelect = useCallback(
      (triggerId: string, enableTriggerMode?: boolean) => {
        // Get the trigger name
        const triggerName = TriggerUtils.getDefaultTriggerName(triggerId) || triggerId

        // Create the trigger block at the center of the viewport
        const centerPosition = projectViewportCenter()
        const id = crypto.randomUUID()

        // Add the trigger block with trigger mode if specified
        addBlock(
          id,
          triggerId,
          triggerName,
          centerPosition,
          undefined,
          undefined,
          undefined,
          undefined,
          enableTriggerMode || false
        )
      },
      [addBlock, projectViewportCenter]
    )

    // Update the onDrop handler
    const onDrop = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault()

        try {
          const data = JSON.parse(event.dataTransfer.getData('application/json'))
          if (data.type === 'connectionBlock') return

          const reactFlowBounds = event.currentTarget.getBoundingClientRect()
          const position = project({
            x: event.clientX - reactFlowBounds.left,
            y: event.clientY - reactFlowBounds.top,
          })

          // Check if dropping inside a container node (loop or parallel)
          const containerInfo = isPointInLoopNodeWrapper(position)
          const containerDropTarget =
            containerInfo && !isBlockProtected(containerInfo.loopId, blocks) ? containerInfo : null

          clearContainerHighlights()

          // Special handling for container nodes (loop or parallel)
          if (data.type === 'loop' || data.type === 'parallel') {
            // Create a unique ID and name for the container
            const id = crypto.randomUUID()

            const baseName = data.type === 'loop' ? 'Loop' : 'Parallel'
            const name = getUniqueBlockName(baseName, blocks)

            // Check if we're dropping inside another container
            if (containerDropTarget) {
              // Calculate position relative to the parent container
              const relativePosition = {
                x: position.x - containerDropTarget.loopPosition.x,
                y: position.y - containerDropTarget.loopPosition.y,
              }

              // Add the container as a child of the parent container (will be marked as error)
              addBlock(id, data.type, name, relativePosition, {
                width: 500,
                height: 300,
                type: 'subflowNode',
                parentId: containerDropTarget.loopId,
                extent: 'parent',
              })

              // Resize the parent container to fit the new child container
              resizeLoopNodesWrapper()
            } else {
              // Auto-connect the container to the closest node on the canvas
              const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
              let autoConnectEdge
              if (isAutoConnectEnabled) {
                const closestBlock = findClosestOutput(position)
                if (closestBlock) {
                  const sourceHandle = determineSourceHandle(closestBlock)

                  autoConnectEdge = {
                    id: crypto.randomUUID(),
                    source: closestBlock.id,
                    target: id,
                    sourceHandle,
                    targetHandle: 'target',
                    type: 'workflowEdge',
                  }
                }
              }

              // Add the container node directly to canvas with default dimensions and auto-connect edge
              addBlock(
                id,
                data.type,
                name,
                position,
                {
                  width: 500,
                  height: 300,
                  type: 'subflowNode',
                },
                undefined,
                undefined,
                autoConnectEdge
              )
            }

            return
          }

          const blockConfig = getBlock(data.type)
          if (!blockConfig && data.type !== 'loop' && data.type !== 'parallel') {
            logger.error('Invalid block type:', { data })
            return
          }

          // Generate id and name here so they're available in all code paths
          const id = crypto.randomUUID()
          // Prefer semantic default names for triggers; then ensure unique numbering centrally
          const defaultTriggerNameDrop = TriggerUtils.getDefaultTriggerName(data.type)
          const baseName =
            data.type === 'loop'
              ? 'Loop'
              : data.type === 'parallel'
                ? 'Parallel'
                : defaultTriggerNameDrop || blockConfig!.name
          const name = getUniqueBlockName(baseName, blocks)

          if (containerDropTarget) {
            // Calculate position relative to the container node
            const relativePosition = {
              x: position.x - containerDropTarget.loopPosition.x,
              y: position.y - containerDropTarget.loopPosition.y,
            }

            // Capture existing child blocks before adding the new one
            const existingChildBlocks = Object.values(blocks).filter(
              (b) => b.data?.parentId === containerDropTarget.loopId
            )

            // Auto-connect logic for blocks inside containers
            const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
            let autoConnectEdge
            if (isAutoConnectEnabled && blockConfig?.category !== 'triggers') {
              if (existingChildBlocks.length > 0) {
                // Connect to the nearest existing child block within the container
                const closestBlock = existingChildBlocks
                  .map((b) => ({
                    block: b,
                    distance: Math.sqrt(
                      (b.position.x - relativePosition.x) ** 2 +
                        (b.position.y - relativePosition.y) ** 2
                    ),
                  }))
                  .sort((a, b) => a.distance - b.distance)[0]?.block

                if (closestBlock) {
                  const sourceHandle = determineSourceHandle({
                    id: closestBlock.id,
                    type: closestBlock.type,
                  })
                  autoConnectEdge = {
                    id: crypto.randomUUID(),
                    source: closestBlock.id,
                    target: id,
                    sourceHandle,
                    targetHandle: 'target',
                    type: 'workflowEdge',
                  }
                }
              } else {
                // No existing children: connect from the container's start handle to the moved node
                const containerNode = getNodes().find((n) => n.id === containerDropTarget.loopId)
                const startSourceHandle =
                  (containerNode?.data as any)?.kind === 'loop'
                    ? 'loop-start-source'
                    : 'parallel-start-source'

                autoConnectEdge = {
                  id: crypto.randomUUID(),
                  source: containerDropTarget.loopId,
                  target: id,
                  sourceHandle: startSourceHandle,
                  targetHandle: 'target',
                  type: 'workflowEdge',
                }
              }
            }

            // Add block with parent info AND autoConnectEdge (atomic operation)
            addBlock(
              id,
              data.type,
              name,
              relativePosition,
              {
                parentId: containerDropTarget.loopId,
                extent: 'parent',
              },
              containerDropTarget.loopId,
              'parent',
              autoConnectEdge
            )

            // Resize the container node to fit the new block
            // Immediate resize without delay
            resizeLoopNodesWrapper()
          } else {
            // Centralized trigger constraints
            const dropIssue = TriggerUtils.getTriggerAdditionIssue(blocks, data.type)
            if (dropIssue) {
              setTriggerWarning({
                open: true,
                triggerName: dropIssue.triggerName,
                type: TriggerWarningType.DUPLICATE_TRIGGER,
              })
              return
            }

            // Regular auto-connect logic
            const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
            let autoConnectEdge
            if (isAutoConnectEnabled && blockConfig?.category !== 'triggers') {
              const closestBlock = findClosestOutput(position)
              if (closestBlock) {
                const sourceHandle = determineSourceHandle(closestBlock)

                autoConnectEdge = {
                  id: crypto.randomUUID(),
                  source: closestBlock.id,
                  target: id,
                  sourceHandle,
                  targetHandle: 'target',
                  type: 'workflowEdge',
                }
              }
            }

            // Regular canvas drop with auto-connect edge
            // Use enableTriggerMode from drag data if present (when dragging from Triggers tab)
            const enableTriggerMode = data.enableTriggerMode || false
            addBlock(
              id,
              data.type,
              name,
              position,
              undefined,
              undefined,
              undefined,
              autoConnectEdge,
              enableTriggerMode
            )
          }
        } catch (err) {
          logger.error('Error dropping block:', { err })
        }
      },
      [
        project,
        blocks,
        addBlock,
        findClosestOutput,
        determineSourceHandle,
        isPointInLoopNodeWrapper,
        getNodes,
        setTriggerWarning,
      ]
    )

    // Handle drag over for ReactFlow canvas
    const onDragOver = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault()

        // Only handle toolbar items
        if (!event.dataTransfer?.types.includes('application/json')) return

        try {
          const reactFlowBounds = event.currentTarget.getBoundingClientRect()
          const position = project({
            x: event.clientX - reactFlowBounds.left,
            y: event.clientY - reactFlowBounds.top,
          })

          // Check if hovering over a container node
          const containerInfo = isPointInLoopNodeWrapper(position)
          const containerDropTarget =
            containerInfo && !isBlockProtected(containerInfo.loopId, blocks) ? containerInfo : null

          clearContainerHighlights()

          // If hovering over a container node, highlight it
          if (containerDropTarget) {
            applyContainerHighlight(containerDropTarget.loopId, getNodes)
          }
        } catch (err) {
          logger.error('Error in onDragOver', { err })
        }
      },
      [project, isPointInLoopNodeWrapper, getNodes, blocks]
    )

    // Initialize workflow when it exists in registry and isn't active
    useEffect(() => {
      const currentId = effectiveWorkflowId
      if (!currentId || !workflows[currentId]) return

      if (activeWorkflowId !== currentId) {
        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()
        setActiveWorkflow({ workflowId: currentId, channelId: resolvedChannelId }).catch(
          (error) => {
            logger.error('Failed to activate workflow for channel', {
              error,
              channelId: resolvedChannelId,
            })
          }
        )
      }
    }, [effectiveWorkflowId, workflows, activeWorkflowId, setActiveWorkflow, resolvedChannelId])

    // Track when workflow is ready for rendering
    useEffect(() => {
      const currentId = effectiveWorkflowId

      // Workflow is ready when:
      // 1. We have an active workflow that matches the URL
      // 2. The workflow exists in the registry
      // 3. This channel is not currently hydrating
      const shouldBeReady =
        currentId !== null &&
        activeWorkflowId === currentId &&
        Boolean(workflows[currentId]) &&
        !isChannelHydrating

      setIsWorkflowReady(shouldBeReady)
    }, [activeWorkflowId, effectiveWorkflowId, workflows, isChannelHydrating])

    // Handle navigation and validation
    useEffect(() => {
      if (!shouldHandleNavigation) {
        return
      }

      const validateAndNavigate = async () => {
        const workflowIds = Object.keys(workflows)
        const currentId = workflowId

        // Wait for initial load to complete before making navigation decisions
        if (!hasWorkflowsInitiallyLoaded() || hydration.phase === 'metadata-loading') {
          return
        }

        // If no workflows exist after loading, redirect to workspace root
        if (workflowIds.length === 0) {
          logger.info('No workflows found, redirecting to workspace root')
          router.replace(`/workspace/${workspaceId}/w`)
          return
        }

        // Navigate to existing workflow or first available
        if (!workflows[currentId]) {
          logger.info(`Workflow ${currentId} not found, redirecting to first available workflow`)

          // Validate that workflows belong to the current workspace before redirecting
          const workspaceWorkflows = workflowIds.filter((id) => {
            const workflow = workflows[id]
            return workflow.workspaceId === workspaceId
          })

          if (workspaceWorkflows.length > 0) {
            router.replace(`/workspace/${workspaceId}/w/${workspaceWorkflows[0]}`)
          } else {
            // No valid workflows for this workspace, redirect to workspace root
            router.replace(`/workspace/${workspaceId}/w`)
          }
          return
        }

        // Validate that the current workflow belongs to the current workspace
        const currentWorkflow = workflows[currentId]
        if (currentWorkflow && currentWorkflow.workspaceId !== workspaceId) {
          logger.warn(
            `Workflow ${currentId} belongs to workspace ${currentWorkflow.workspaceId}, not ${workspaceId}`
          )
          // Redirect to the correct workspace for this workflow
          router.replace(`/workspace/${currentWorkflow.workspaceId}/w/${currentId}`)
          return
        }
      }

      validateAndNavigate()
    }, [
      shouldHandleNavigation,
      workflowId,
      workflows,
      hydration.phase,
      workspaceId,
      router,
      hasWorkflowsInitiallyLoaded,
    ])

    const blockConfigCache = useRef(new Map())
    const getBlockConfig = useCallback((type: string) => {
      return getBlockConfigFromCache(blockConfigCache.current, type)
    }, [])

    // Track previous blocks hash to prevent unnecessary recalculations
    const prevBlocksHashRef = useRef<string>('')
    const prevBlocksRef = useRef(blocks)

    const blocksHash = useMemo(() => {
      return getStableBlocksHash(blocks, prevBlocksRef, prevBlocksHashRef)
    }, [blocks])

    const nodes = useMemo(() => {
      const derivedNodes = deriveCanvasNodes({
        blocks,
        activeBlockIds,
        pendingBlocks,
        isDebugging,
        nestedSubflowErrors,
        resolveBlockConfig: getBlockConfig,
        resolveNodeDescriptor: resolveCanvasNodeDescriptor,
        onMissingBlockConfig: (block) => {
          logger.error(`No configuration found for block type: ${block.type}`, {
            block,
          })
        },
      })

      return derivedNodes.map((node) => ({
        ...node,
        selected: selectedNodeId !== null && node.id === selectedNodeId,
      }))
    }, [
      blocksHash,
      blocks,
      activeBlockIds,
      pendingBlocks,
      isDebugging,
      nestedSubflowErrors,
      getBlockConfig,
      selectedNodeId,
    ])

    // Update nodes - use store version to avoid collaborative feedback loops
    const onNodesChange = useCallback(
      (changes: any) => {
        changes.forEach((change: any) => {
          if (change.type === 'position' && change.position) {
            const node = nodes.find((n) => n.id === change.id)
            if (!node) return
            // Use store version to avoid collaborative feedback loop
            // React Flow position changes can be triggered by collaborative updates
            storeUpdateBlockPosition(change.id, change.position)
          }
        })
      },
      [nodes, storeUpdateBlockPosition]
    )

    // Effect to resize loops when nodes change (add/remove/position change)
    useEffect(() => {
      // Skip during initial render when nodes aren't loaded yet
      if (nodes.length === 0) return

      // Resize all loops to fit their children
      resizeLoopNodesWrapper()

      // No need for cleanup with direct function
      return () => {}
    }, [nodes, resizeLoopNodesWrapper])

    // Special effect to handle cleanup after node deletion
    useEffect(() => {
      // Create a mapping of node IDs to check for missing parent references
      const nodeIds = new Set(Object.keys(blocks))

      // Check for nodes with invalid parent references
      Object.entries(blocks).forEach(([id, block]) => {
        const parentId = block.data?.parentId

        // If block has a parent reference but parent no longer exists
        if (parentId && !nodeIds.has(parentId)) {
          logger.warn('Found orphaned node with invalid parent reference', {
            nodeId: id,
            missingParentId: parentId,
          })

          // Fix the node by removing its parent reference and calculating absolute position
          const absolutePosition = getNodeAbsolutePositionWrapper(id)

          // Update the node to remove parent reference and use absolute position
          collaborativeUpdateBlockPosition(id, absolutePosition)
          updateParentId(id, '', 'parent')
        }
      })
    }, [blocks, collaborativeUpdateBlockPosition, updateParentId, getNodeAbsolutePositionWrapper])

    // Validate nested subflows whenever blocks change
    useEffect(() => {
      validateNestedSubflows()
    }, [blocks, validateNestedSubflows])

    const isProtectedBlockId = useCallback(
      (blockId?: string | null) => {
        if (!blockId) return false
        return isBlockProtected(blockId, blocks)
      },
      [blocks]
    )

    const removeEdgeIfAllowed = useCallback(
      (edgeId: string) => {
        const edge = edgesForDisplay.find((candidate) => candidate.id === edgeId)
        if (edge && isProtectedBlockId(edge.target)) {
          return false
        }

        removeEdge(edgeId)
        return true
      },
      [edgesForDisplay, isProtectedBlockId, removeEdge]
    )

    // Update edges
    const onEdgesChange = useCallback(
      (changes: any) => {
        changes.forEach((change: any) => {
          if (change.type === 'remove') {
            removeEdgeIfAllowed(change.id)
          }
        })
      },
      [removeEdgeIfAllowed]
    )

    const onConnect = useCallback(
      (connection: any) => {
        if (!connection?.target || isProtectedBlockId(connection.target)) {
          return
        }

        const nextEdge = createConnectionEdge({
          connection,
          nodes: getNodes(),
          blocks,
        })

        if (!nextEdge) {
          return
        }

        addEdge(nextEdge)
      },
      [addEdge, getNodes, blocks, isProtectedBlockId]
    )

    // Handle node drag to detect intersections with container nodes
    const onNodeDrag = useCallback(
      (_event: React.MouseEvent, node: any) => {
        collaborativeUpdateBlockPosition(node.id, node.position, false)

        const draggedBlockConfig = node.data?.type ? getBlock(node.data.type) : null
        const isTriggerBlock = draggedBlockConfig?.category === 'triggers'
        if (isTriggerBlock) {
          if (potentialParentId) {
            clearContainerHighlights()
            setPotentialParentId(null)
          }
          return
        }

        const bestContainerId = findBestContainerForDraggedNode({
          node,
          blocks,
          getNodes,
        })

        if (!bestContainerId) {
          if (potentialParentId) {
            clearContainerHighlights()
            setPotentialParentId(null)
          }
          return
        }

        if (bestContainerId !== potentialParentId) {
          clearContainerHighlights()
          applyContainerHighlight(bestContainerId, getNodes)
          setPotentialParentId(bestContainerId)
        }
      },
      [getNodes, potentialParentId, blocks, collaborativeUpdateBlockPosition]
    )

    // Add in a nodeDrag start event to set the dragStartParentId
    const onNodeDragStart = useCallback(
      (_event: React.MouseEvent, node: any) => {
        // Store the original parent ID when starting to drag
        const currentParentId = blocks[node.id]?.data?.parentId || null
        setDragStartParentId(currentParentId)
        // Store starting position for undo/redo move entry
        setDragStartPosition({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          parentId: currentParentId,
        })
      },
      [blocks, setDragStartPosition]
    )

    // Handle node drag stop to establish parent-child relationships
    const onNodeDragStop = useCallback(
      (_event: React.MouseEvent, node: any) => {
        clearContainerHighlights()
        collaborativeUpdateBlockPosition(node.id, node.position, true)

        try {
          const start = getDragStartPosition()
          if (start && start.id === node.id) {
            const before = { x: start.x, y: start.y, parentId: start.parentId }
            const after = {
              x: node.position.x,
              y: node.position.y,
              parentId: node.parentId || blocks[node.id]?.data?.parentId,
            }
            const moved =
              before.x !== after.x || before.y !== after.y || before.parentId !== after.parentId
            if (moved) {
              if (effectiveWorkflowId) {
                emitWorkflowRecordMove({
                  channelId: resolvedChannelId,
                  workflowId: effectiveWorkflowId,
                  blockId: node.id,
                  before,
                  after,
                })
              }
            }
            setDragStartPosition(null)
          }
        } catch {}

        if (potentialParentId === dragStartParentId) {
          setPotentialParentId(null)
          return
        }

        const draggedBlockConfig = node.data?.type ? getBlock(node.data.type) : null
        const isTriggerBlock = draggedBlockConfig?.category === 'triggers'
        if (isTriggerBlock) {
          logger.warn('Prevented trigger block from being placed inside a container', {
            blockId: node.id,
            attemptedParentId: potentialParentId,
          })
          setPotentialParentId(null)
          return
        }

        if (potentialParentId && !isProtectedBlockId(potentialParentId)) {
          const containerAbsPosBefore = getNodeAbsolutePositionWrapper(potentialParentId)
          const nodeAbsPosBefore = getNodeAbsolutePositionWrapper(node.id)
          const relativePositionBefore = {
            x: nodeAbsPosBefore.x - containerAbsPosBefore.x,
            y: nodeAbsPosBefore.y - containerAbsPosBefore.y,
          }

          const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
          const edgesToAdd = isAutoConnectEnabled
            ? buildAutoConnectEdgesForContainerDrop({
                blocks,
                getNodes,
                targetParentId: potentialParentId,
                nodeId: node.id,
                relativePosition: relativePositionBefore,
                determineSourceHandle,
              })
            : []

          if (!effectiveWorkflowId) {
            setPotentialParentId(null)
            return
          }

          emitSkipEdgeRecording({
            channelId: resolvedChannelId,
            workflowId: effectiveWorkflowId,
            skip: true,
          })
          updateNodeParent(node.id, potentialParentId, edgesToAdd)
          edgesToAdd.forEach((edge) => addEdge(edge))
          emitSkipEdgeRecording({
            channelId: resolvedChannelId,
            workflowId: effectiveWorkflowId,
            skip: false,
          })
        }

        setPotentialParentId(null)
      },
      [
        getNodes,
        dragStartParentId,
        potentialParentId,
        updateNodeParent,
        collaborativeUpdateBlockPosition,
        addEdge,
        determineSourceHandle,
        blocks,
        isProtectedBlockId,
        getNodeAbsolutePositionWrapper,
        getDragStartPosition,
        setDragStartPosition,
        resolvedChannelId,
        effectiveWorkflowId,
      ]
    )

    const onPaneClick = useCallback(() => {
      setSelectedEdgeInfo(null)
      setSelectedNodeId(null)
    }, [])
    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        return
      }
      setSelectedEdgeInfo(null)
      setSelectedNodeId(node.id)
    }, [])

    const nodeIndexForSelection = useMemo(() => createNodeIndex(nodes), [nodes])

    const onEdgeClick = useCallback(
      (event: React.MouseEvent, edge: any) => {
        event.stopPropagation()
        setSelectedEdgeInfo(getSelectedEdgeInfo(edge, nodeIndexForSelection))
      },
      [nodeIndexForSelection]
    )

    const edgesWithSelection = useMemo(
      () =>
        deriveEdgesWithSelection({
          edges: edgesForDisplay,
          nodeIndex: nodeIndexForSelection,
          selectedEdgeInfo,
          onDelete: (edgeId: string) => {
            const removed = removeEdgeIfAllowed(edgeId)
            if (removed && selectedEdgeInfo?.id === edgeId) {
              setSelectedEdgeInfo(null)
            }
          },
        }),
      [edgesForDisplay, nodeIndexForSelection, removeEdgeIfAllowed, selectedEdgeInfo]
    )

    // Handle keyboard shortcuts with better edge tracking
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeInfo) {
          // Only delete the specific selected edge
          const removed = removeEdgeIfAllowed(selectedEdgeInfo.id)
          if (removed) {
            setSelectedEdgeInfo(null)
          }
        }
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectedEdgeInfo, removeEdgeIfAllowed])

    // Handle sub-block value updates from custom events
    useEffect(() => {
      if (!effectiveWorkflowId) {
        return
      }

      const handleSubBlockValueUpdate = ({
        blockId,
        subBlockId,
        value,
      }: UpdateSubBlockValuePayload) => {
        if (blockId && subBlockId) {
          // Use collaborative function to go through queue system
          // This ensures 5-second timeout and error detection work
          collaborativeSetSubblockValue(blockId, subBlockId, value)
        }
      }

      return subscribeUpdateSubBlockValue(
        { channelId: resolvedChannelId, workflowId: effectiveWorkflowId },
        handleSubBlockValueUpdate
      )
    }, [collaborativeSetSubblockValue, resolvedChannelId, effectiveWorkflowId])

    // Show skeleton UI while loading until the workflow store is hydrated
    const showSkeletonUI = !isWorkflowReady

    if (showSkeletonUI) {
      return (
        <div className={`flex ${containerHeightClass} w-full flex-col overflow-hidden`}>
          <div className='relative h-full w-full flex-1 transition-all duration-200'>
            <div className='workflow-container h-full'>
              <Background color='hsl(var(--workflow-dots))' size={4} gap={40} />
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className={`${containerHeightClass} w-full overflow-hidden`}>
        <div className='relative h-full min-w-0 flex-1 transition-all duration-200'>
          {/* Floating Control Bar */}
          {uiConfig.controlBar && (
            <ControlBar
              hasValidationErrors={nestedSubflowErrors.size > 0}
              hasLockedBlocks={hasLockedBlocks}
            />
          )}

          {/* Floating Controls (Zoom, Undo, Redo) */}
          {uiConfig.floatingControls && (
            <FloatingControls constrainToContainer={Boolean(viewportBounds)} />
          )}

          {/* Training Controls - for recording workflow edits */}
          {uiConfig.trainingControls && (
            <TrainingControls
              channelId={resolvedChannelId}
              forceVisible={uiConfig.forceTrainingControls}
              constrainToContainer={Boolean(viewportBounds)}
            />
          )}

          <ReactFlow
            id={reactFlowId}
            nodes={nodes}
            edges={edgesWithSelection}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={effectivePermissions.canEdit ? onConnect : undefined}
            onNodeClick={onNodeClick}
            nodeTypes={workflowNodeTypes}
            edgeTypes={workflowEdgeTypes}
            onDrop={effectivePermissions.canEdit ? onDrop : undefined}
            onDragOver={effectivePermissions.canEdit ? onDragOver : undefined}
            onInit={(instance) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  instance.fitView({ padding: 0.3 })
                })
              })
            }}
            minZoom={0.1}
            maxZoom={1.3}
            panOnScroll
            defaultEdgeOptions={defaultEdgeOptions}
            proOptions={{ hideAttribution: true }}
            connectionLineStyle={connectionLineStyle}
            connectionLineType={ConnectionLineType.Bezier}
            connectionLineComponent={WorkflowConnectionLine}
            onPaneClick={onPaneClick}
            onEdgeClick={onEdgeClick}
            elementsSelectable={true}
            selectNodesOnDrag={false}
            nodesConnectable={effectivePermissions.canEdit}
            nodesDraggable={effectivePermissions.canEdit}
            draggable={false}
            noWheelClassName='allow-scroll'
            edgesFocusable={true}
            edgesUpdatable={effectivePermissions.canEdit}
            className='workflow-container h-full'
            onNodeDrag={effectivePermissions.canEdit ? onNodeDrag : undefined}
            onNodeDragStop={effectivePermissions.canEdit ? onNodeDragStop : undefined}
            onNodeDragStart={effectivePermissions.canEdit ? onNodeDragStart : undefined}
            snapToGrid={false}
            snapGrid={snapGrid}
            elevateEdgesOnSelect={true}
            // Performance optimizations
            onlyRenderVisibleElements={true}
            deleteKeyCode={null}
            elevateNodesOnSelect={true}
            autoPanOnConnect={effectivePermissions.canEdit}
            autoPanOnNodeDrag={effectivePermissions.canEdit}
          >
            <Background color='hsl(var(--workflow-dots))' size={4} gap={40} />
            <NodeEditorPanel selectedNodeId={selectedNodeId} />
          </ReactFlow>

          {/* Show DiffControls if diff is available (regardless of current view mode) */}
          {uiConfig.diffControls && <DiffControls constrainToContainer={Boolean(viewportBounds)} />}

          {/* Trigger warning dialog */}
          <TriggerWarningDialog
            open={triggerWarning.open}
            onOpenChange={(open) => {
              setTriggerWarning((prev) => (prev.open === open ? prev : { ...prev, open }))
            }}
            triggerName={triggerWarning.triggerName}
            type={triggerWarning.type}
          />

          {/* Trigger list for empty workflows - only show after workflow has loaded and hydrated */}
          {uiConfig.triggerList &&
            isWorkflowReady &&
            isWorkflowEmpty &&
            effectivePermissions.canEdit && <TriggerList onSelect={handleTriggerSelect} />}
        </div>
      </div>
    )
  }
)

WorkflowCanvas.displayName = 'WorkflowCanvas'

export { WorkflowCanvas }
export default WorkflowCanvas
