import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { applyAutoLayout } from '@/lib/workflows/autolayout'
import { requireWorkflowRealtimeState } from '@/lib/workflows/db-helpers'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { createWorkflowRealtimeRequiredResponse } from '@/app/api/workflows/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('AutoLayoutAPI')

const AutoLayoutRequestSchema = z.object({
  spacing: z
    .object({
      horizontal: z.number().min(100).max(1000).optional(),
      vertical: z.number().min(50).max(500).optional(),
    })
    .optional(),
  alignment: z.enum(['start', 'center', 'end']).optional(),
  padding: z
    .object({
      x: z.number().min(50).max(500).optional(),
      y: z.number().min(50).max(500).optional(),
    })
    .optional(),
  blocks: z.record(z.string(), z.any()).optional(),
  edges: z.array(z.any()).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const { error, session } = await validateWorkflowPermissions(workflowId, requestId, 'write')
    if (error || !session?.user?.id) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized' },
        { status: error?.status ?? 401 }
      )
    }

    const userId = session.user.id

    const body = await request.json()
    const layoutOptions = AutoLayoutRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing autolayout request for workflow ${workflowId}`, {
      userId,
    })

    const currentWorkflowState = await requireWorkflowRealtimeState(workflowId)

    if (!currentWorkflowState) {
      logger.error(`[${requestId}] Could not load workflow ${workflowId} for autolayout`)
      return NextResponse.json({ error: 'Could not load workflow data' }, { status: 500 })
    }

    const layoutInput =
      layoutOptions.blocks && layoutOptions.edges
        ? { blocks: layoutOptions.blocks, edges: layoutOptions.edges }
        : { blocks: currentWorkflowState.blocks, edges: currentWorkflowState.edges }

    if (layoutOptions.blocks && layoutOptions.edges) {
      logger.info(`[${requestId}] Using provided blocks with live measurements`)
    } else {
      logger.info(`[${requestId}] Loading blocks from current workflow state`)
    }

    const autoLayoutOptions = {
      horizontalSpacing: layoutOptions.spacing?.horizontal ?? 550,
      verticalSpacing: layoutOptions.spacing?.vertical ?? 200,
      padding: {
        x: layoutOptions.padding?.x ?? 150,
        y: layoutOptions.padding?.y ?? 150,
      },
      alignment: layoutOptions.alignment ?? 'center',
    }

    const layoutResult = applyAutoLayout(layoutInput.blocks, layoutInput.edges, autoLayoutOptions)

    if (!layoutResult.success || !layoutResult.blocks) {
      logger.error(`[${requestId}] Auto layout failed:`, {
        error: layoutResult.error,
      })
      return NextResponse.json(
        {
          error: 'Auto layout failed',
          details: layoutResult.error || 'Unknown error',
        },
        { status: 500 }
      )
    }

    await applyWorkflowState(
      workflowId,
      userId,
      createWorkflowSnapshot({
        direction: currentWorkflowState.direction,
        blocks: layoutResult.blocks,
        edges: layoutInput.edges,
        loops: currentWorkflowState.loops,
        parallels: currentWorkflowState.parallels,
      })
    )

    const elapsed = Date.now() - startTime
    const blockCount = Object.keys(layoutResult.blocks).length

    logger.info(`[${requestId}] Autolayout completed successfully in ${elapsed}ms`, {
      blockCount,
      workflowId,
    })

    return NextResponse.json({
      success: true,
      message: `Autolayout applied successfully to ${blockCount} blocks`,
      data: {
        blockCount,
        elapsed: `${elapsed}ms`,
      },
    })
  } catch (error) {
    const elapsed = Date.now() - startTime
    const realtimeResponse = createWorkflowRealtimeRequiredResponse(error)
    if (realtimeResponse) return realtimeResponse

    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid autolayout request data`, { errors: error.issues })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Autolayout failed after ${elapsed}ms:`, error)
    return NextResponse.json(
      {
        error: 'Autolayout failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
