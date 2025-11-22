import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('AutoLayoutUtils')

/**
 * Default auto layout options (now using native compact spacing)
 */
export const DEFAULT_AUTO_LAYOUT_OPTIONS: AutoLayoutOptions = {
  strategy: 'smart',
  direction: 'auto',
  spacing: {
    horizontal: 550,
    vertical: 200,
    layer: 550,
  },
  alignment: 'center',
  padding: {
    x: 150,
    y: 150,
  },
}

/**
 * Auto layout options interface
 */
export interface AutoLayoutOptions {
  strategy?: 'smart' | 'hierarchical' | 'layered' | 'force-directed'
  direction?: 'horizontal' | 'vertical' | 'auto'
  spacing?: {
    horizontal?: number
    vertical?: number
    layer?: number
  }
  alignment?: 'start' | 'center' | 'end'
  padding?: {
    x?: number
    y?: number
  }
}

/**
 * Apply auto layout to workflow blocks and update the store
 */
export async function applyAutoLayoutToWorkflow(
  workflowId: string,
  blocks: Record<string, any>,
  edges: any[],
  loops: Record<string, any> = {},
  parallels: Record<string, any> = {},
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  layoutedBlocks?: Record<string, any>
  error?: string
}> {
  try {
    logger.info('Applying auto layout to workflow', {
      workflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
    })

    // Call the autolayout API route instead of sim-agent directly

    // Merge with default options and ensure all required properties are present
    const layoutOptions = {
      strategy: options.strategy || DEFAULT_AUTO_LAYOUT_OPTIONS.strategy!,
      direction: options.direction || DEFAULT_AUTO_LAYOUT_OPTIONS.direction!,
      spacing: {
        horizontal: options.spacing?.horizontal || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing!.horizontal!,
        vertical: options.spacing?.vertical || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing!.vertical!,
        layer: options.spacing?.layer || DEFAULT_AUTO_LAYOUT_OPTIONS.spacing!.layer!,
      },
      alignment: options.alignment || DEFAULT_AUTO_LAYOUT_OPTIONS.alignment!,
      padding: {
        x: options.padding?.x || DEFAULT_AUTO_LAYOUT_OPTIONS.padding!.x!,
        y: options.padding?.y || DEFAULT_AUTO_LAYOUT_OPTIONS.padding!.y!,
      },
    }

    // Call the autolayout API route, sending blocks with live measurements
    const response = await fetch(`/api/workflows/${workflowId}/autolayout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...layoutOptions,
        blocks,
        edges,
        loops,
        parallels,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      const errorMessage = errorData?.error || `Auto layout failed: ${response.statusText}`
      logger.error('Auto layout API call failed:', {
        status: response.status,
        error: errorMessage,
      })
      return {
        success: false,
        error: errorMessage,
      }
    }

    const result = await response.json()

    if (!result.success) {
      const errorMessage = result.error || 'Auto layout failed'
      logger.error('Auto layout failed:', {
        error: errorMessage,
      })
      return {
        success: false,
        error: errorMessage,
      }
    }

    logger.info('Successfully applied auto layout', {
      workflowId,
      originalBlockCount: Object.keys(blocks).length,
      layoutedBlockCount: result.data?.layoutedBlocks
        ? Object.keys(result.data.layoutedBlocks).length
        : 0,
    })

    // Return the layouted blocks from the API response
    return {
      success: true,
      layoutedBlocks: result.data?.layoutedBlocks || blocks,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown auto layout error'
    logger.error('Auto layout failed:', { workflowId, error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Apply auto layout and update the workflow store immediately
 */
interface ApplyAutoLayoutAndUpdateStoreParams {
  workflowId: string
  channelId?: string
  options?: AutoLayoutOptions
  undoUserId?: string
}

export async function applyAutoLayoutAndUpdateStore({
  workflowId,
  channelId,
  options = {},
  undoUserId,
}: ApplyAutoLayoutAndUpdateStoreParams): Promise<{
  success: boolean
  error?: string
}> {
  let resolvedWorkflowId: string | undefined = workflowId

  try {
    // Import workflow store
    const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
    const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')

    const registryState = useWorkflowRegistry.getState()
    const activeWorkflowIdForChannel = registryState.getActiveWorkflowId(channelId)
    resolvedWorkflowId = workflowId ?? activeWorkflowIdForChannel

    if (!resolvedWorkflowId) {
      logger.error('Auto layout aborted: no active workflow for channel', { channelId })
      return { success: false, error: 'No workflow selected' }
    }

    if (workflowId && workflowId !== activeWorkflowIdForChannel) {
      logger.warn('Auto layout workflow mismatch detected, correcting', {
        requestedWorkflowId: workflowId,
        activeWorkflowIdForChannel,
        channelId,
      })
    }

    const workflowStore = useWorkflowStore.getState(channelId)
    const { useUndoRedoStore } = await import('@/stores/undo-redo')
    const { createOperationEntry } = await import('@/stores/undo-redo/utils')
    const prevBlocks = workflowStore.blocks
    const { blocks, edges, loops = {}, parallels = {} } = workflowStore

    logger.info('Auto layout store data:', {
      workflowId: resolvedWorkflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
      loopCount: Object.keys(loops).length,
      parallelCount: Object.keys(parallels).length,
    })

    if (Object.keys(blocks).length === 0) {
      logger.warn('No blocks to layout', { workflowId: resolvedWorkflowId })
      return { success: false, error: 'No blocks to layout' }
    }

    // Apply auto layout
    const result = await applyAutoLayoutToWorkflow(
      resolvedWorkflowId,
      blocks,
      edges,
      loops,
      parallels,
      options
    )

    if (!result.success || !result.layoutedBlocks) {
      return { success: false, error: result.error }
    }

    // Build undo entry for auto-layout (single action captures all node moves)
    const moves =
      undoUserId && resolvedWorkflowId
        ? Object.entries(result.layoutedBlocks || {}).reduce(
            (acc, [id, block]) => {
              const before = prevBlocks[id]?.position
              if (
                before &&
                (Math.abs(before.x - block.position.x) > 0.01 ||
                  Math.abs(before.y - block.position.y) > 0.01)
              ) {
                acc.push({
                  blockId: id,
                  before: {
                    x: before.x,
                    y: before.y,
                    parentId: prevBlocks[id]?.data?.parentId,
                  },
                  after: {
                    x: block.position.x,
                    y: block.position.y,
                    parentId: block.data?.parentId,
                  },
                })
              }
              return acc
            },
            [] as Array<{
              blockId: string
              before: { x: number; y: number; parentId?: string }
              after: { x: number; y: number; parentId?: string }
            }>
          )
        : []

    if (moves.length > 0) {
      const operation = {
        id: crypto.randomUUID(),
        type: 'auto-layout' as const,
        timestamp: Date.now(),
        workflowId: resolvedWorkflowId!,
        userId: undoUserId!,
        data: { moves },
      }
      const inverse = {
        ...operation,
        data: {
          moves: moves.map((m) => ({
            blockId: m.blockId,
            before: m.after,
            after: m.before,
          })),
        },
      }
      const entry = createOperationEntry(operation as any, inverse as any)
      useUndoRedoStore.getState().push(resolvedWorkflowId!, undoUserId!, entry)
    }

    // Update workflow store immediately with new positions
    const newWorkflowState = {
      ...workflowStore.getWorkflowState(),
      blocks: result.layoutedBlocks,
      lastSaved: Date.now(),
    }

    useWorkflowStore.setStateForChannel(newWorkflowState, channelId, false)

    logger.info('Successfully updated workflow store with auto layout', {
      workflowId: resolvedWorkflowId,
      channelId,
    })

    // Persist the changes to the database optimistically
    try {
      // Update the lastSaved timestamp in the store
      useWorkflowStore.getState(channelId).updateLastSaved()

      // Clean up the workflow state for API validation
      // Destructure out UI-only fields that shouldn't be persisted
      const { deploymentStatuses, needsRedeployment, dragStartPosition, ...stateToSave } =
        newWorkflowState

      const cleanedWorkflowState = {
        ...stateToSave,
        // Convert null dates to undefined (since they're optional)
        deployedAt: stateToSave.deployedAt ? new Date(stateToSave.deployedAt) : undefined,
        // Ensure other optional fields are properly handled
        loops: stateToSave.loops || {},
        parallels: stateToSave.parallels || {},
        // Sanitize edges: remove null/empty handle fields to satisfy schema (optional strings)
        edges: (stateToSave.edges || []).map((edge: any) => {
          const { sourceHandle, targetHandle, ...rest } = edge || {}
          const sanitized: any = { ...rest }
          if (typeof sourceHandle === 'string' && sourceHandle.length > 0) {
            sanitized.sourceHandle = sourceHandle
          }
          if (typeof targetHandle === 'string' && targetHandle.length > 0) {
            sanitized.targetHandle = targetHandle
          }
          return sanitized
        }),
      }

      // Save the updated workflow state to the database
    const response = await fetch(`/api/workflows/${resolvedWorkflowId}/state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cleanedWorkflowState),
    })

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorData = await response.json()
        const details =
          typeof errorData?.details === 'string'
            ? errorData.details
            : JSON.stringify(errorData?.details || errorData)
        errorMessage = errorData?.error
          ? `${errorData.error}${details ? ` - ${details}` : ''}`
          : errorMessage
      } catch (parseError) {
        // Ignore JSON parse errors and fall back to generic message
      }

      throw new Error(errorMessage)
    }

      logger.info('Auto layout successfully persisted to database', {
        workflowId: resolvedWorkflowId,
        channelId,
      })
      return { success: true }
    } catch (saveError) {
      const message =
        saveError instanceof Error && saveError.message
          ? saveError.message
          : JSON.stringify(saveError)
      logger.error('Failed to save auto layout to database, reverting store changes:', {
        workflowId: resolvedWorkflowId,
        error: message,
      })

      // Revert the store changes since database save failed
      useWorkflowStore.setStateForChannel(
        {
          ...workflowStore.getWorkflowState(),
          blocks, // Revert to original blocks
          lastSaved: workflowStore.lastSaved, // Revert lastSaved
        },
        channelId,
        false
      )

      return {
        success: false,
        error: `Failed to save positions to database: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`,
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown store update error'
    logger.error('Failed to update store with auto layout:', {
      workflowId: resolvedWorkflowId ?? workflowId,
      error: errorMessage,
    })

    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Apply auto layout to a specific set of blocks (used by copilot preview)
 */
export async function applyAutoLayoutToBlocks(
  blocks: Record<string, any>,
  edges: any[],
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  layoutedBlocks?: Record<string, any>
  error?: string
}> {
  return applyAutoLayoutToWorkflow('preview', blocks, edges, {}, {}, options)
}
