import { db } from '@tradinggoose/db'
import { templates, workflow } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { getBaseUrl } from '@/lib/urls/utils'
import { regenerateWorkflowStateIds } from '@/lib/workflows/db-helpers'

const logger = createLogger('TemplateUseAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/templates/[id]/use - Use a template (increment views and create workflow)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized use attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get workspace ID from request body
    const body = await request.json()
    const { workspaceId } = body

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId in request body`)
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    logger.debug(
      `[${requestId}] Using template: ${id}, user: ${session.user.id}, workspace: ${workspaceId}`
    )

    // Get the template with its data
    const template = await db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        state: templates.state,
        color: templates.color,
      })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)

    if (template.length === 0) {
      logger.warn(`[${requestId}] Template not found: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const templateData = template[0]

    // Create a new workflow ID
    const newWorkflowId = uuidv4()
    const now = new Date()

    const templateState =
      templateData.state && typeof templateData.state === 'object' ? (templateData.state as any) : null

    const templateVariables =
      templateState?.variables && typeof templateState.variables === 'object'
        ? (templateState.variables as Record<string, any>)
        : null

    const remappedVariables: Record<string, any> = (() => {
      if (!templateVariables) return {}
      const mapped: Record<string, any> = {}
      Object.values(templateVariables).forEach((variable: any) => {
        const newVarId = uuidv4()
        mapped[newVarId] = {
          ...variable,
          id: newVarId,
          workflowId: newWorkflowId,
        }
      })
      return mapped
    })()

    await db.insert(workflow).values({
      id: newWorkflowId,
      workspaceId: workspaceId,
      name: `${templateData.name} (copy)`,
      description: templateData.description,
      color: templateData.color,
      userId: session.user.id,
      variables: remappedVariables,
      createdAt: now,
      updatedAt: now,
      lastSynced: now,
    })

    if (templateState) {
      const regeneratedState = regenerateWorkflowStateIds(templateState)
      const { variables: _variables, ...stateWithoutVariables } = regeneratedState as any

      const stateResponse = await fetch(`${getBaseUrl()}/api/workflows/${newWorkflowId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie: request.headers.get('cookie') || '',
        },
        body: JSON.stringify(stateWithoutVariables),
      })

      if (!stateResponse.ok) {
        logger.error(`[${requestId}] Failed to save workflow state for template use`)
        await db.delete(workflow).where(eq(workflow.id, newWorkflowId))
        return NextResponse.json(
          { error: 'Failed to create workflow from template' },
          { status: 500 }
        )
      }
    }

    await db
      .update(templates)
      .set({
        views: sql`${templates.views} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))

    logger.info(
      `[${requestId}] Successfully used template: ${id}, created workflow: ${newWorkflowId}`
    )

    // Track template usage
    try {
      const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
      const templateState = templateData.state as any
      trackPlatformEvent('platform.template.used', {
        'template.id': id,
        'template.name': templateData.name,
        'workflow.created_id': newWorkflowId,
        'workflow.blocks_count': templateState?.blocks
          ? Object.keys(templateState.blocks).length
          : 0,
        'workspace.id': workspaceId,
      })
    } catch (_e) {
      // Silently fail
    }

    // Verify the workflow was actually created
    const verifyWorkflow = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, newWorkflowId))
      .limit(1)

    if (verifyWorkflow.length === 0) {
      logger.error(`[${requestId}] Workflow was not created properly: ${newWorkflowId}`)
      return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
    }

    return NextResponse.json(
      {
        message: 'Template used successfully',
        workflowId: newWorkflowId,
        workspaceId: workspaceId,
      },
      { status: 201 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error using template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
