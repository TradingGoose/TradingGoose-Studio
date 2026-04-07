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

    // Call the autolayout API route instead of copilot directly

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
    // Import Yjs session registry for imperative access
    const { getRegisteredWorkflowSession } = await import('@/lib/yjs/workflow-session-registry')
    const { getWorkflowSnapshot, getWorkflowMap } = await import('@/lib/yjs/workflow-session')
    const { YJS_ORIGINS } = await import('@/lib/yjs/transaction-origins')
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

    // Read workflow state from Yjs doc
    const session = getRegisteredWorkflowSession(resolvedWorkflowId)
    if (!session?.doc) {
      logger.error('Auto layout aborted: no Yjs session for workflow', { workflowId: resolvedWorkflowId })
      return { success: false, error: 'No active workflow session' }
    }

    const snapshot = getWorkflowSnapshot(session.doc)
    const { blocks, edges, loops = {}, parallels = {} } = snapshot
    const hasLockedBlocks = Object.values(blocks).some((block) => Boolean(block.locked))

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

    if (hasLockedBlocks) {
      logger.info('Auto layout skipped: workflow contains locked blocks', {
        workflowId: resolvedWorkflowId,
      })
      return {
        success: false,
        error: 'Auto-layout is disabled when blocks are locked. Unlock blocks to use auto-layout.',
      }
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

    // Update Yjs doc directly with new block positions
    const doc = session.doc
    doc.transact(() => {
      const wMap = getWorkflowMap(doc)
      wMap.set('blocks', result.layoutedBlocks!)
      wMap.set('lastSaved', Date.now())
    }, YJS_ORIGINS.USER)

    logger.info('Successfully updated Yjs doc with auto layout', {
      workflowId: resolvedWorkflowId,
      channelId,
    })

    // Persist the changes to the database optimistically
    try {
      const updatedSnapshot = getWorkflowSnapshot(doc)

      // Clean up the workflow state for API validation.
      // Undefined keys are omitted during JSON serialization.
      const stateToSave = {
        ...updatedSnapshot,
        deploymentStatuses: undefined,
        needsRedeployment: undefined,
        dragStartPosition: undefined,
      }

      const cleanedWorkflowState = {
        ...stateToSave,
        // Convert null dates to undefined (since they're optional)
        deployedAt: (stateToSave as any).deployedAt ? new Date((stateToSave as any).deployedAt) : undefined,
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
        } catch {
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
      logger.error('Failed to save auto layout to database, reverting Yjs doc:', {
        workflowId: resolvedWorkflowId,
        error: message,
      })

      // Revert the Yjs doc changes since database save failed
      doc.transact(() => {
        const wMap = getWorkflowMap(doc)
        wMap.set('blocks', blocks) // Revert to original blocks
      }, YJS_ORIGINS.SYSTEM)

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
