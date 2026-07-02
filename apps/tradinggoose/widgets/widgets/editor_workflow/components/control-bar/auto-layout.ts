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

export async function applyAutoLayoutToWorkflow(
  workflowId: string,
  blocks: Record<string, any>,
  edges: any[],
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
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
      layoutedBlockCount: result.data?.blockCount ?? 0,
    })

    return {
      success: true,
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

interface ApplyAutoLayoutParams {
  workflowId: string
  options?: AutoLayoutOptions
}

export async function applyAutoLayoutToActiveWorkflow({
  workflowId,
  options = {},
}: ApplyAutoLayoutParams): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const { getRegisteredWorkflowSession } = await import('@/lib/yjs/workflow-session-registry')
    const { readWorkflowSnapshot } = await import('@/lib/yjs/workflow-session')

    if (!workflowId) {
      logger.error('Auto layout aborted: no workflow selected')
      return { success: false, error: 'No workflow selected' }
    }

    const session = getRegisteredWorkflowSession(workflowId)
    if (!session?.doc) {
      logger.error('Auto layout aborted: no Yjs session for workflow', {
        workflowId,
      })
      return { success: false, error: 'No active workflow session' }
    }

    const snapshot = readWorkflowSnapshot(session.doc)
    const { blocks, edges } = snapshot
    const hasLockedBlocks = Object.values(blocks).some((block) => Boolean(block.locked))

    logger.info('Auto layout store data:', {
      workflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
    })

    if (Object.keys(blocks).length === 0) {
      logger.warn('No blocks to layout', { workflowId })
      return { success: false, error: 'No blocks to layout' }
    }

    if (hasLockedBlocks) {
      logger.info('Auto layout skipped: workflow contains locked blocks', {
        workflowId,
      })
      return {
        success: false,
        error: 'Auto-layout is disabled when blocks are locked. Unlock blocks to use auto-layout.',
      }
    }

    const result = await applyAutoLayoutToWorkflow(workflowId, blocks, edges, options)

    if (!result.success) {
      return { success: false, error: result.error }
    }

    logger.info('Successfully applied durable auto layout', {
      workflowId,
    })
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown store update error'
    logger.error('Failed to update store with auto layout:', {
      workflowId,
      error: errorMessage,
    })

    return {
      success: false,
      error: errorMessage,
    }
  }
}
