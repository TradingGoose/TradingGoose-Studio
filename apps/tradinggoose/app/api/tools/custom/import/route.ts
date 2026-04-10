import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { parseImportedCustomToolsFile } from '@/lib/custom-tools/import-export'
import { importCustomTools } from '@/lib/custom-tools/operations'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('CustomToolsImportAPI')

const CustomToolsImportRequestSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  file: z.unknown(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized custom tools import attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workspaceId, file } = CustomToolsImportRequestSchema.parse(body)

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

    const parsedCustomTools = parseImportedCustomToolsFile(file)
    const result = await importCustomTools({
      tools: parsedCustomTools.customTools,
      workspaceId,
      userId: authResult.userId,
      requestId,
    })

    return NextResponse.json({
      success: true,
      data: result.tools,
      import: {
        addedCount: result.importedCount,
        renamedCount: result.renamedCount,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid custom tools import data`, { errors: error.errors })
      const workspaceError = error.errors.find(
        (validationError) =>
          validationError.path.length === 1 && validationError.path[0] === 'workspaceId'
      )
      if (workspaceError) {
        return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
      }

      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error importing custom tools`, { error })
    return NextResponse.json({ error: 'Failed to import custom tools' }, { status: 500 })
  }
}
