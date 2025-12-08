import { db } from '@tradinggoose/db'
import { customTools, workflow } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { upsertCustomTools } from '@/lib/custom-tools/operations'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('CustomToolsAPI')

const CustomToolSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  tools: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1, 'Tool title is required'),
      schema: z.object({
        type: z.literal('function'),
        function: z.object({
          name: z.string().min(1, 'Function name is required'),
          description: z.string().optional(),
          parameters: z.object({
            type: z.string(),
            properties: z.record(z.any()),
            required: z.array(z.string()).optional(),
          }),
        }),
      }),
      code: z.string(),
    })
  ),
})

// GET - Fetch all custom tools for a workspace
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get('workspaceId')
  const workflowId = searchParams.get('workflowId')

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tools access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    let resolvedWorkspaceId: string | null = workspaceId

    if (!resolvedWorkspaceId && workflowId) {
      const [workflowData] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflowData?.workspaceId) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      resolvedWorkspaceId = workflowData.workspaceId
    }

    if (!resolvedWorkspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId for custom tools fetch`)
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    // Skip permission check for internal JWT workflow proxy requests
    if (!(authResult.authType === 'internal_jwt' && workflowId)) {
      const permission = await getUserEntityPermissions(userId, 'workspace', resolvedWorkspaceId)
      if (!permission) {
        logger.warn(
          `[${requestId}] User ${userId} does not have access to workspace ${resolvedWorkspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    const result = await db
      .select()
      .from(customTools)
      .where(eq(customTools.workspaceId, resolvedWorkspaceId))
      .orderBy(desc(customTools.createdAt))

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching custom tools:`, error)
    return NextResponse.json({ error: 'Failed to fetch custom tools' }, { status: 500 })
  }
}

// POST - Create or update custom tools
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tools update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      // Validate the request body
      const { tools, workspaceId } = CustomToolSchema.parse(body)

      const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
      if (!permission) {
        logger.warn(
          `[${requestId}] User ${authResult.userId} does not have access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }

      if (permission !== 'admin' && permission !== 'write') {
        logger.warn(
          `[${requestId}] User ${authResult.userId} does not have write permission for workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
      }

      const resultTools = await upsertCustomTools({
        tools,
        workspaceId,
        userId: authResult.userId,
        requestId,
      })

      return NextResponse.json({ success: true, data: resultTools })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid custom tools data`, {
          errors: validationError.errors,
        })

        const workspaceError = validationError.errors.find(
          (err) => err.path.length === 1 && err.path[0] === 'workspaceId'
        )
        if (workspaceError) {
          return NextResponse.json({ error: workspaceError.message }, { status: 400 })
        }

        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating custom tools`, error)
    return NextResponse.json({ error: 'Failed to update custom tools' }, { status: 500 })
  }
}

// DELETE - Delete a custom tool by ID
export async function DELETE(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const toolId = searchParams.get('id')
  const workspaceId = searchParams.get('workspaceId')

  if (!toolId) {
    logger.warn(`[${requestId}] Missing tool ID for deletion`)
    return NextResponse.json({ error: 'Tool ID is required' }, { status: 400 })
  }
  if (!workspaceId) {
    logger.warn(`[${requestId}] Missing workspaceId for deletion`)
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tool deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permission = await getUserEntityPermissions(authResult.userId, 'workspace', workspaceId)
    if (!permission) {
      logger.warn(
        `[${requestId}] User ${authResult.userId} does not have access to workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (permission !== 'admin' && permission !== 'write') {
      logger.warn(
        `[${requestId}] User ${authResult.userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    // Check if the tool exists in this workspace
    const existingTool = await db
      .select()
      .from(customTools)
      .where(and(eq(customTools.id, toolId), eq(customTools.workspaceId, workspaceId)))
      .limit(1)

    if (existingTool.length === 0) {
      logger.warn(`[${requestId}] Tool not found: ${toolId}`)
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    // Delete the tool
    await db.delete(customTools).where(eq(customTools.id, toolId))

    logger.info(`[${requestId}] Deleted tool: ${toolId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting custom tool:`, error)
    return NextResponse.json({ error: 'Failed to delete custom tool' }, { status: 500 })
  }
}
