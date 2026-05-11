import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('AutoLayoutUtils')

interface AutoLayoutOptions {
  spacing?: {
    horizontal?: number
    vertical?: number
  }
  alignment?: 'start' | 'center' | 'end'
  padding?: {
    x?: number
    y?: number
  }
}

function sanitizeEdgesForStateSave(edges: any[]): any[] {
  return edges.flatMap((edge: any, index: number) => {
    const source = typeof edge?.source === 'string' ? edge.source.trim() : ''
    const target = typeof edge?.target === 'string' ? edge.target.trim() : ''

    if (!source || !target) {
      return []
    }

    const sourceHandle =
      typeof edge?.sourceHandle === 'string' && edge.sourceHandle.length > 0
        ? edge.sourceHandle
        : undefined
    const targetHandle =
      typeof edge?.targetHandle === 'string' && edge.targetHandle.length > 0
        ? edge.targetHandle
        : undefined

    return [
      {
        ...edge,
        id:
          typeof edge?.id === 'string' && edge.id.length > 0
            ? edge.id
            : `${source}-${sourceHandle || 'source'}-${target}-${targetHandle || 'target'}-${index}`,
        source,
        target,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
      },
    ]
  })
}

export async function applyAutoLayoutToWorkflow(
  workflowId: string,
  blocks: Record<string, any>,
  edges: any[],
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

    const layoutOptions = {
      spacing: {
        horizontal: options.spacing?.horizontal ?? 550,
        vertical: options.spacing?.vertical ?? 200,
      },
      alignment: options.alignment ?? 'center',
      padding: {
        x: options.padding?.x ?? 150,
        y: options.padding?.y ?? 150,
      },
    }

    const response = await fetch(`/api/workflows/${workflowId}/autolayout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...layoutOptions,
        blocks,
        edges,
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

interface ApplyAutoLayoutAndUpdateStoreParams {
  workflowId: string
  channelId?: string
  options?: AutoLayoutOptions
}

export async function applyAutoLayoutAndUpdateStore({
  workflowId,
  channelId,
  options = {},
}: ApplyAutoLayoutAndUpdateStoreParams): Promise<{
  success: boolean
  error?: string
}> {
  let resolvedWorkflowId: string | undefined = workflowId

  try {
    const { getRegisteredWorkflowSession } = await import('@/lib/yjs/workflow-session-registry')
    const { readWorkflowSnapshot, readWorkflowMap } = await import('@/lib/yjs/workflow-session')
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

    const session = getRegisteredWorkflowSession(resolvedWorkflowId)
    if (!session?.doc) {
      logger.error('Auto layout aborted: no Yjs session for workflow', {
        workflowId: resolvedWorkflowId,
      })
      return { success: false, error: 'No active workflow session' }
    }

    const snapshot = readWorkflowSnapshot(session.doc)
    const { blocks, edges } = snapshot
    const hasLockedBlocks = Object.values(blocks).some((block) => Boolean(block.locked))

    logger.info('Auto layout store data:', {
      workflowId: resolvedWorkflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
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

    const result = await applyAutoLayoutToWorkflow(resolvedWorkflowId, blocks, edges, options)

    if (!result.success || !result.layoutedBlocks) {
      return { success: false, error: result.error }
    }

    const doc = session.doc
    doc.transact(() => {
      const wMap = readWorkflowMap(doc)
      wMap.set('blocks', result.layoutedBlocks!)
      wMap.set('lastSaved', Date.now())
    }, YJS_ORIGINS.USER)

    logger.info('Successfully updated Yjs doc with auto layout', {
      workflowId: resolvedWorkflowId,
      channelId,
    })

    try {
      const updatedSnapshot = readWorkflowSnapshot(doc)

      const stateToSave = {
        ...updatedSnapshot,
        deploymentStatuses: undefined,
        needsRedeployment: undefined,
        dragStartPosition: undefined,
      }

      const cleanedWorkflowState = {
        ...stateToSave,
        deployedAt: (stateToSave as any).deployedAt
          ? new Date((stateToSave as any).deployedAt)
          : undefined,
        loops: stateToSave.loops || {},
        parallels: stateToSave.parallels || {},
        edges: sanitizeEdgesForStateSave(stateToSave.edges || []),
      }

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

      doc.transact(() => {
        const wMap = readWorkflowMap(doc)
        wMap.set('blocks', blocks)
      }, YJS_ORIGINS.SYSTEM)

      return {
        success: false,
        error: `Failed to save positions to database: ${
          saveError instanceof Error ? saveError.message : 'Unknown error'
        }`,
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
