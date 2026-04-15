import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ExecuteCopilotServerToolAPI')

const ExecuteSchema = z.object({
  toolName: z.string().min(1),
  payload: z.unknown().optional(),
})

export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  let toolName: z.infer<typeof ToolIds> | undefined
  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    try {
      const preview = JSON.stringify(body).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Incoming request body preview`, { preview })
    } catch {}

    let parsedBody: z.infer<typeof ExecuteSchema>
    try {
      parsedBody = ExecuteSchema.parse(body)
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.debug(`[${tracker.requestId}] Execute request envelope validation error`, {
          issues: error.issues,
        })
        return createBadRequestResponse('Invalid request body for execute-copilot-server-tool')
      }
      throw error
    }
    toolName = parsedBody.toolName
    const { payload } = parsedBody

    const [{ isToolId }, { routeExecution }] = await Promise.all([
      import('@/lib/copilot/registry'),
      import('@/lib/copilot/tools/server/router'),
    ])

    if (!isToolId(toolName)) {
      return createBadRequestResponse('Invalid request body for execute-copilot-server-tool')
    }

    logger.info(`[${tracker.requestId}] Executing server tool`, { toolName })
    const result = await routeExecution(toolName, payload, { userId })

    try {
      const resultPreview = JSON.stringify(result).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Server tool result preview`, { toolName, resultPreview })
    } catch {}

    return NextResponse.json({ success: true, result })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Failed to execute server tool:`, error)
    const structuredError = buildCopilotServerToolErrorResponse(toolName, error)
    return NextResponse.json(structuredError.body, { status: structuredError.status })
  }
}
