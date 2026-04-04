import { useCallback, useMemo } from 'react'
import { useLatestRef } from '@/hooks/use-latest-ref'
import type { Edge } from 'reactflow'
import { resolveStoredDateValue } from '@/lib/time-format'
import {
  useWorkflowBlocks,
  useWorkflowEdges,
  useWorkflowLoops,
  useWorkflowParallels,
  useWorkflowDoc,
} from '@/lib/yjs/use-workflow-doc'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

/**
 * Interface for the current workflow abstraction
 */
export interface CurrentWorkflow {
  // Current workflow state properties
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  lastSaved?: number
  isDeployed?: boolean
  deployedAt?: Date
  // Helper methods
  getBlockById: (blockId: string) => BlockState | undefined
  getBlockCount: () => number
  getEdgeCount: () => number
  hasBlocks: () => boolean
  hasEdges: () => boolean
}

/**
 * Clean abstraction for accessing the current workflow state.
 * Always returns the normal workflow state (diff store has been retired).
 * Now reads directly from the Yjs document via use-workflow-doc hooks.
 */
export function useCurrentWorkflow(): CurrentWorkflow {
  const blocks = useWorkflowBlocks()
  const edges = useWorkflowEdges()
  const loops = useWorkflowLoops()
  const parallels = useWorkflowParallels()
  const { isDeployed, deployedAt: rawDeployedAt, lastSaved: rawLastSaved } = useWorkflowDoc()

  // Keep refs in sync so stable callbacks always read current data
  const blocksRef = useLatestRef(blocks)
  const edgesRef = useLatestRef(edges)

  // Stable helper callbacks that read from refs — their identity never changes
  const getBlockById = useCallback(
    (blockId: string) => blocksRef.current?.[blockId],
    []
  )
  const getBlockCount = useCallback(
    () => Object.keys(blocksRef.current || {}).length,
    []
  )
  const getEdgeCount = useCallback(
    () => (edgesRef.current || []).length,
    []
  )
  const hasBlocks = useCallback(
    () => Object.keys(blocksRef.current || {}).length > 0,
    []
  )
  const hasEdges = useCallback(
    () => (edgesRef.current || []).length > 0,
    []
  )

  // Create the abstracted interface - optimized to prevent unnecessary re-renders
  // Note: stable callbacks (getBlockById, etc.) are intentionally omitted from deps
  // since their identity never changes (empty dep arrays on useCallback).
  const currentWorkflow = useMemo((): CurrentWorkflow => {
    const lastSaved = resolveStoredDateValue(rawLastSaved)?.getTime()
    const deployedAt = resolveStoredDateValue(rawDeployedAt)

    const resolvedBlocks = blocks || {}
    const resolvedEdges = edges || []
    const resolvedLoops = loops || {}
    const resolvedParallels = parallels || {}

    return {
      // Current workflow state
      blocks: resolvedBlocks,
      edges: resolvedEdges,
      loops: resolvedLoops,
      parallels: resolvedParallels,
      lastSaved,
      isDeployed,
      deployedAt,
      // Helper methods — stable references from useCallback above
      getBlockById,
      getBlockCount,
      getEdgeCount,
      hasBlocks,
      hasEdges,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callbacks (getBlockById, etc.) never change
  }, [blocks, edges, loops, parallels, rawLastSaved, rawDeployedAt, isDeployed])

  return currentWorkflow
}
