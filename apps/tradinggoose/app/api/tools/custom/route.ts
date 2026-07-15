import { db } from '@tradinggoose/db'
import { customTools } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createCustomTools, listCustomTools } from '@/lib/custom-tools/operations'
import { CustomToolCreateRequestSchema } from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { readWorkflowAccessContext } from '@/lib/workflows/utils'
import { SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import { lockSavedEntityList } from '@/lib/yjs/server/entity-loaders'
import {
  discardYjsSessionInSocketServer,
  refreshEntityListSession,
} from '@/lib/yjs/server/snapshot-bridge'

const logger = createLogger('CustomToolsAPI')

// GET - Fetch all custom tools for a workspace
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  const searchParams = request.nextUrl.searchParams
  const queryWorkspaceId = searchParams.get('workspaceId')?.trim() ?? ''
  const workflowId = searchParams.get('workflowId')?.trim() ?? ''

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tools access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    let workspaceId = queryWorkspaceId
    if (!workspaceId && workflowId) {
      const accessContext = await readWorkflowAccessContext(workflowId, userId)
      if (!accessContext) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }
      if (
        !accessContext.isOwner &&
        !accessContext.isWorkspaceOwner &&
        !accessContext.workspacePermission
      ) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
      if (!accessContext.workflow.workspaceId) {
        return NextResponse.json({ error: 'Workflow workspace is missing' }, { status: 404 })
      }
      workspaceId = accessContext.workflow.workspaceId
    } else if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId or workflowId for custom tools fetch`)
      return NextResponse.json({ error: 'workspaceId or workflowId is required' }, { status: 400 })
    } else {
      const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
      if (!permission) {
        logger.warn(
          `[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    return NextResponse.json({ data: await listCustomTools({ workspaceId }) }, { status: 200 })
  } catch (error) {
    if (error instanceof SavedEntityRealtimeRequiredError) {
      return NextResponse.json(error.responseBody(), { status: error.status })
    }
    logger.error(`[${requestId}] Error fetching custom tools:`, error)
    return NextResponse.json({ error: 'Failed to fetch custom tools' }, { status: 500 })
  }
}

// POST - Create custom tools
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
      const { tools, workspaceId } = CustomToolCreateRequestSchema.parse(body)

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

      const resultTools = await createCustomTools({
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
      if (validationError instanceof Error && validationError.message.includes('already exists')) {
        return NextResponse.json({ error: validationError.message }, { status: 409 })
      }
      throw validationError
    }
  } catch (error) {
    if (error instanceof SavedEntityRealtimeRequiredError) {
      return NextResponse.json(error.responseBody(), { status: error.status })
    }
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

    const deleted = await db.transaction(async (tx) => {
      await lockSavedEntityList(tx, 'custom_tool', workspaceId)
      const [row] = await tx
        .delete(customTools)
        .where(and(eq(customTools.id, toolId), eq(customTools.workspaceId, workspaceId)))
        .returning({ id: customTools.id })
      return Boolean(row)
    })
    if (!deleted) {
      logger.warn(`[${requestId}] Tool not found: ${toolId}`)
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    await refreshEntityListSession('custom_tool', workspaceId)
    await Promise.allSettled([discardYjsSessionInSocketServer(toolId)])

    logger.info(`[${requestId}] Deleted tool: ${toolId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting custom tool:`, error)
    return NextResponse.json({ error: 'Failed to delete custom tool' }, { status: 500 })
  }
}
