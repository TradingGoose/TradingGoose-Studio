import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { importIndicators } from '@/lib/indicators/custom/operations'
import { parseImportedIndicatorsFile } from '@/lib/indicators/import-export'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '@/app/api/indicators/utils'

const logger = createLogger('IndicatorsImportAPI')

const IndicatorsImportRequestSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  file: z.unknown(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'import',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const body = await request.json()

    try {
      const { workspaceId, file } = IndicatorsImportRequestSchema.parse(body)

      const permissionCheck = await checkWorkspacePermission({
        userId: auth.userId,
        workspaceId,
        requireWrite: true,
        responseShape: 'errorOnly',
      })
      if (!permissionCheck.ok) {
        return permissionCheck.response
      }

      const parsedFile = parseImportedIndicatorsFile(file)
      const result = await importIndicators({
        indicators: parsedFile.indicators,
        workspaceId,
        userId: auth.userId,
        requestId,
      })

      return NextResponse.json({
        success: true,
        data: result.indicators,
        import: {
          addedCount: result.importedCount,
          renamedCount: result.renamedCount,
        },
      })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid indicators import data`, {
          errors: validationError.errors,
        })

        const workspaceError = validationError.errors.find(
          (error) => error.path.length === 1 && error.path[0] === 'workspaceId'
        )
        if (workspaceError) {
          return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
        }

        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }

      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error importing indicators`, { error })
    return NextResponse.json({ error: 'Failed to import indicators' }, { status: 500 })
  }
}
