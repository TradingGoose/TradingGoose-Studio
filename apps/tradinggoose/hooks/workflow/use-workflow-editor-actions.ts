import { useCallback } from 'react'
import type { Edge } from '@xyflow/react'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks'
import { useWorkflowMutations } from '@/lib/yjs/use-workflow-doc'
import { useWorkflowSession } from '@/lib/yjs/workflow-session-host'
import type { YjsOrigin } from '@/lib/yjs/transaction-origins'
import { getUniqueBlockName } from '@/stores/workflows/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/types'
import type { Position } from '@/stores/workflows/workflow/types'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('WorkflowEditorActions')

/**
 * Workflow editor mutations backed directly by the live Yjs session.
 */
export function useWorkflowEditorActions() {
  const workflowRoute = useOptionalWorkflowRoute()
  const channelId = workflowRoute?.channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID
  const routeWorkflowId = workflowRoute?.workflowId ?? null
  const activeWorkflowId = useWorkflowRegistry(
    useCallback((state) => state.getActiveWorkflowId(channelId), [channelId])
  )

  const { getWorkflowSnapshot } = useWorkflowSession()
  const mutations = useWorkflowMutations()

  const getBlocksSnapshot = useCallback(() => {
    return getWorkflowSnapshot()?.blocks ?? {}
  }, [getWorkflowSnapshot])

  const getEdgesSnapshot = useCallback(() => {
    return getWorkflowSnapshot()?.edges ?? []
  }, [getWorkflowSnapshot])

  // Derive connection status from whether we have an active workflow
  const isConnectedToWorkflow = !!activeWorkflowId

  const collaborativeAddBlock = useCallback(
    (
      id: string,
      type: string,
      name: string,
      position: Position,
      data?: Record<string, any>,
      parentId?: string,
      extent?: 'parent',
      autoConnectEdge?: Edge,
      triggerMode?: boolean
    ) => {
      const blockConfig = getBlock(type)

      // Handle loop/parallel blocks that don't use BlockConfig
      if (!blockConfig && (type === 'loop' || type === 'parallel')) {
        mutations.addBlock(id, type, name, position, data, parentId, extent, {
          locked: false,
          triggerMode: triggerMode || false,
        })
        if (autoConnectEdge) {
          mutations.addEdge(autoConnectEdge)
        }
        return
      }

      if (!blockConfig) {
        logger.error(`Block type ${type} not found`)
        return
      }

      // Apply locally - Yjs handles sync
      mutations.addBlock(id, type, name, position, data, parentId, extent, {
        locked: false,
        triggerMode: triggerMode || false,
      })
      if (autoConnectEdge) {
        mutations.addEdge(autoConnectEdge)
      }
    },
    [mutations]
  )

  const collaborativeRemoveBlock = useCallback(
    (id: string) => {
      mutations.removeBlock(id)
    },
    [mutations]
  )

  const collaborativeUpdateBlockPositions = useCallback(
    (
      updates: Array<{ id: string; position: Position }>,
      options?: {
        origin?: YjsOrigin
      }
    ) => {
      mutations.updateBlockPositions(updates, options)
    },
    [mutations]
  )

  const collaborativeUpdateBlockPosition = useCallback(
    (
      id: string,
      position: Position,
      options?: {
        origin?: YjsOrigin
      }
    ) => {
      mutations.updateBlockPosition(id, position, options)
    },
    [mutations]
  )

  const collaborativeUpdateBlockName = useCallback(
    (id: string, name: string) => {
      mutations.updateBlockName(id, name)
    },
    [mutations]
  )

  const collaborativeToggleBlockEnabled = useCallback(
    (id: string) => {
      mutations.toggleBlockEnabled(id)
    },
    [mutations]
  )

  const collaborativeUpdateParentId = useCallback(
    (id: string, parentId: string, extent: 'parent') => {
      mutations.updateParentId(id, parentId, extent)
    },
    [mutations]
  )

  const collaborativeUpdateParentIds = useCallback(
    (updates: Array<{ id: string; parentId: string; extent: 'parent' }>) => {
      mutations.updateParentIds(updates)
    },
    [mutations]
  )

  const collaborativeToggleBlockWide = useCallback(
    (id: string) => {
      mutations.toggleBlockWide(id)
    },
    [mutations]
  )

  const collaborativeToggleBlockAdvancedMode = useCallback(
    (id: string) => {
      const blocks = getBlocksSnapshot()
      mutations.setBlockAdvancedMode(id, !blocks[id]?.advancedMode)
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeToggleBlockTriggerMode = useCallback(
    (id: string) => {
      const blocks = getBlocksSnapshot()
      mutations.setBlockTriggerMode(id, !blocks[id]?.triggerMode)
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeToggleBlockHandles = useCallback(
    (id: string) => {
      mutations.toggleBlockHandles(id)
    },
    [mutations]
  )

  const collaborativeToggleBlockLocked = useCallback(
    (id: string) => {
      mutations.toggleBlockLocked(id)
    },
    [mutations]
  )

  const collaborativeAddEdge = useCallback(
    (edge: Edge) => {
      mutations.addEdge(edge)
    },
    [mutations]
  )

  const collaborativeRemoveEdge = useCallback(
    (edgeId: string) => {
      const edges = getEdgesSnapshot()
      const blocks = getBlocksSnapshot()
      const edge = edges.find((e) => e.id === edgeId)

      // Skip if edge doesn't exist (already removed during cascade deletion)
      if (!edge) {
        logger.debug('Edge already removed, skipping operation', { edgeId })
        return
      }

      // Check if the edge's source and target blocks still exist
      const sourceExists = blocks[edge.source]
      const targetExists = blocks[edge.target]

      if (!sourceExists || !targetExists) {
        logger.debug('Edge source or target block no longer exists, skipping operation', {
          edgeId,
          sourceExists: !!sourceExists,
          targetExists: !!targetExists,
        })
        return
      }

      mutations.removeEdge(edgeId)
    },
    [getBlocksSnapshot, getEdgesSnapshot, mutations]
  )

  const collaborativeSetSubblockValue = useCallback(
    (blockId: string, subblockId: string, value: any, options?: { _visited?: Set<string> }) => {
      // Write directly to Yjs doc
      mutations.setSubBlockValue(blockId, subblockId, value)

      // Declarative clearing: clear sub-blocks that depend on this subblockId
      try {
        const visited = options?._visited || new Set<string>()
        if (visited.has(subblockId)) return
        visited.add(subblockId)
        const blockType = getBlocksSnapshot()?.[blockId]?.type
        const blockConfig = blockType ? getBlock(blockType) : null
        if (blockConfig?.subBlocks && Array.isArray(blockConfig.subBlocks)) {
          const dependents = blockConfig.subBlocks.filter(
            (sb: any) => Array.isArray(sb.dependsOn) && sb.dependsOn.includes(subblockId)
          )
          for (const dep of dependents) {
            // Skip clearing if the dependent is the same field
            if (!dep?.id || dep.id === subblockId) continue
            // Cascade using the same collaborative path so it further cascades
            collaborativeSetSubblockValue(blockId, dep.id, '', { _visited: visited })
          }
        }
      } catch {
        // Best-effort; do not block on clearing
      }
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeSetTagSelection = useCallback(
    (blockId: string, subblockId: string, value: any) => {
      // Write directly to Yjs doc
      mutations.setSubBlockValue(blockId, subblockId, value)
    },
    [mutations]
  )

  const collaborativeDuplicateBlock = useCallback(
    (sourceId: string) => {
      const currentBlocks = getBlocksSnapshot()
      const sourceBlock = currentBlocks[sourceId]
      if (!sourceBlock) return

      // Generate new ID and calculate position
      const newId = crypto.randomUUID()
      const offsetPosition = {
        x: sourceBlock.position.x + 250,
        y: sourceBlock.position.y + 20,
      }

      const newName = getUniqueBlockName(sourceBlock.name, currentBlocks)

      // Collect source subblock values so they are applied in the same
      // transaction as addBlock (avoids N separate Yjs transactions).
      const initialSubBlockValues: Record<string, any> = {}
      if (sourceBlock.subBlocks) {
        for (const [sbId, sb] of Object.entries(sourceBlock.subBlocks)) {
          if ((sb as any)?.value !== undefined) {
            initialSubBlockValues[sbId] = (sb as any).value
          }
        }
      }

      mutations.addBlock(
        newId,
        sourceBlock.type,
        newName,
        offsetPosition,
        sourceBlock.data ? JSON.parse(JSON.stringify(sourceBlock.data)) : {},
        sourceBlock.data?.parentId,
        sourceBlock.data?.extent,
        {
          enabled: sourceBlock.enabled,
          locked: false,
          horizontalHandles: sourceBlock.horizontalHandles,
          isWide: sourceBlock.isWide,
          advancedMode: sourceBlock.advancedMode,
          triggerMode: false, // Always duplicate as normal mode
          height: sourceBlock.layout?.measuredHeight ?? sourceBlock.height,
          initialSubBlockValues,
        }
      )
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeUpdateLoopType = useCallback(
    (loopId: string, loopType: 'for' | 'forEach' | 'while' | 'doWhile') => {
      const currentBlock = getBlocksSnapshot()[loopId]
      if (!currentBlock || currentBlock.type !== 'loop') return

      mutations.updateLoopType(loopId, loopType)
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeUpdateParallelType = useCallback(
    (parallelId: string, parallelType: 'count' | 'collection') => {
      const currentBlock = getBlocksSnapshot()[parallelId]
      if (!currentBlock || currentBlock.type !== 'parallel') return

      mutations.updateParallelType(parallelId, parallelType)

      // Apply side effects for type change
      if (parallelType === 'count') {
        mutations.updateParallelCollection(parallelId, '')
      } else {
        mutations.updateParallelCount(parallelId, 1)
      }
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeUpdateIterationCount = useCallback(
    (nodeId: string, iterationType: 'loop' | 'parallel', count: number) => {
      const currentBlock = getBlocksSnapshot()[nodeId]
      if (!currentBlock || currentBlock.type !== iterationType) return

      if (iterationType === 'loop') {
        mutations.updateLoopCount(nodeId, count)
      } else {
        mutations.updateParallelCount(nodeId, count)
      }
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeUpdateIterationCollection = useCallback(
    (nodeId: string, iterationType: 'loop' | 'parallel', collection: string) => {
      const currentBlock = getBlocksSnapshot()[nodeId]
      if (!currentBlock || currentBlock.type !== iterationType) return

      if (iterationType === 'loop') {
        mutations.updateLoopCollection(nodeId, collection)
      } else {
        mutations.updateParallelCollection(nodeId, collection)
      }
    },
    [getBlocksSnapshot, mutations]
  )

  const collaborativeUpdateVariable = useCallback(
    (variableId: string, field: 'name' | 'value' | 'type', value: any) => {
      mutations.updateVariable(variableId, { [field]: value })
    },
    [mutations]
  )

  const collaborativeAddVariable = useCallback(
    (variableData: { name: string; type: any; value: any; workflowId: string }) => {
      const workflowId = variableData.workflowId || routeWorkflowId || activeWorkflowId
      if (!workflowId) {
        return ''
      }

      return mutations.addVariable({
        ...variableData,
        workflowId,
      })
    },
    [activeWorkflowId, mutations, routeWorkflowId]
  )

  const collaborativeDeleteVariable = useCallback(
    (variableId: string) => {
      mutations.deleteVariable(variableId)
    },
    [mutations]
  )

  const collaborativeDuplicateVariable = useCallback(
    (variableId: string) => {
      return mutations.duplicateVariable(variableId)
    },
    [mutations]
  )

  return {
    // Connection status
    isConnected: isConnectedToWorkflow,

    // Collaborative operations
    collaborativeAddBlock,
    collaborativeUpdateBlockPosition,
    collaborativeUpdateBlockPositions,
    collaborativeUpdateBlockName,
    collaborativeRemoveBlock,
    collaborativeToggleBlockEnabled,
    collaborativeUpdateParentId,
    collaborativeUpdateParentIds,
    collaborativeToggleBlockWide,
    collaborativeToggleBlockAdvancedMode,
    collaborativeToggleBlockTriggerMode,
    collaborativeToggleBlockHandles,
    collaborativeToggleBlockLocked,
    collaborativeDuplicateBlock,
    collaborativeAddEdge,
    collaborativeRemoveEdge,
    collaborativeSetSubblockValue,
    collaborativeSetTagSelection,

    // Collaborative variable operations
    collaborativeUpdateVariable,
    collaborativeAddVariable,
    collaborativeDeleteVariable,
    collaborativeDuplicateVariable,

    // Collaborative loop/parallel operations
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,

    // Unified iteration operations
    collaborativeUpdateIterationCount,
    collaborativeUpdateIterationCollection,
  }
}
