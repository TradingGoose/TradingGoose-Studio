import { useCallback, useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import { resolveStoredDateValue } from '@/lib/time-format'
import { useWorkflowDoc } from '@/lib/yjs/use-workflow-doc'
import { useLatestRef } from '@/hooks/use-latest-ref'
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
  // Helper methods
  getBlockById: (blockId: string) => BlockState | undefined
}

/**
 * Clean abstraction for accessing the current workflow state.
 * Always returns the normal workflow state (diff store has been retired).
 * Now reads directly from the Yjs document via use-workflow-doc hooks.
 */
export function useCurrentWorkflow(): CurrentWorkflow {
  const { blocks, edges, loops, parallels, lastSaved: rawLastSaved } = useWorkflowDoc()

  // Keep refs in sync so stable callbacks always read current data
  const blocksRef = useLatestRef(blocks)

  // Stable helper callbacks that read from refs — their identity never changes
  const getBlockById = useCallback((blockId: string) => blocksRef.current?.[blockId], [])

  // Create the abstracted interface - optimized to prevent unnecessary re-renders
  // Note: the stable getBlockById callback is intentionally omitted from deps
  // since their identity never changes (empty dep arrays on useCallback).
  const currentWorkflow = useMemo((): CurrentWorkflow => {
    const lastSaved = resolveStoredDateValue(rawLastSaved)?.getTime()

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
      // Helper methods — stable references from useCallback above
      getBlockById,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getBlockById never changes
  }, [blocks, edges, loops, parallels, rawLastSaved])

  return currentWorkflow
}
