import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { applyAutoLayout } from '@/lib/workflows/autolayout'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { readWorkflowAccessContext } from '@/lib/workflows/utils'

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
  blocks: z.record(z.any()).optional(),
  edges: z.array(z.any()).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized autolayout attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const body = await request.json()
    const layoutOptions = AutoLayoutRequestSchema.parse(body)

    logger.info(`[${requestId}] Processing autolayout request for workflow ${workflowId}`, {
      userId,
    })

    const accessContext = await readWorkflowAccessContext(workflowId, userId)
    const workflowData = accessContext?.workflow

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for autolayout`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const canUpdate =
      accessContext?.isOwner ||
      (workflowData.workspaceId
        ? accessContext?.workspacePermission === 'write' ||
          accessContext?.workspacePermission === 'admin'
        : false)

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to autolayout workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    let currentWorkflowData: { blocks: Record<string, any>; edges: any[] } | null

    if (layoutOptions.blocks && layoutOptions.edges) {
      logger.info(`[${requestId}] Using provided blocks with live measurements`)
      currentWorkflowData = {
        blocks: layoutOptions.blocks,
        edges: layoutOptions.edges,
      }
    } else {
      logger.info(`[${requestId}] Loading blocks from database`)
      currentWorkflowData = await loadWorkflowFromNormalizedTables(workflowId)
    }

    if (!currentWorkflowData) {
      logger.error(`[${requestId}] Could not load workflow ${workflowId} for autolayout`)
      return NextResponse.json({ error: 'Could not load workflow data' }, { status: 500 })
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

    const layoutResult = applyAutoLayout(
      currentWorkflowData.blocks,
      currentWorkflowData.edges,
      autoLayoutOptions
    )

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
        layoutedBlocks: layoutResult.blocks,
      },
    })
  } catch (error) {
    const elapsed = Date.now() - startTime

    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid autolayout request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
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
