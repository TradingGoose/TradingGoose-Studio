import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getWorkflowAccessContext } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowApplyLiveStateAPI')

const WorkflowApplyStateSchema = z.object({
  workflowState: z.object({
    direction: z.enum(['TD', 'LR']).optional(),
    blocks: z.record(z.any()),
    edges: z.array(z.any()),
    loops: z.record(z.any()).optional(),
    parallels: z.record(z.any()).optional(),
    lastSaved: z.union([z.string(), z.number()]).optional(),
    isDeployed: z.boolean().optional(),
    deployedAt: z.union([z.string(), z.date()]).optional(),
  }),
})

function toIsoString(value: string | number | Date | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workflowId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessContext = await getWorkflowAccessContext(workflowId, session.user.id)
    const workflowData = accessContext?.workflow

    if (!workflowData) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const canUpdate =
      accessContext?.isOwner ||
      (workflowData.workspaceId
        ? accessContext?.workspacePermission === 'write' ||
          accessContext?.workspacePermission === 'admin'
        : false)

    if (!canUpdate) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { workflowState } = WorkflowApplyStateSchema.parse(body)
    const normalizedWorkflowState = {
      ...(workflowState.direction !== undefined ? { direction: workflowState.direction } : {}),
      blocks: workflowState.blocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
      ...(workflowState.isDeployed !== undefined
        ? { isDeployed: workflowState.isDeployed }
        : {}),
      ...(workflowState.lastSaved !== undefined
        ? { lastSaved: toIsoString(workflowState.lastSaved) }
        : {}),
      ...(workflowState.deployedAt !== undefined
        ? { deployedAt: toIsoString(workflowState.deployedAt) }
        : {}),
    }

    await applyWorkflowState(
      workflowId,
      createWorkflowSnapshot(normalizedWorkflowState)
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Failed to apply workflow state to live Yjs session', {
      workflowId,
      error,
    })

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid workflow state payload' }, { status: 400 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to apply live workflow state' },
      { status: 500 }
    )
  }
}
