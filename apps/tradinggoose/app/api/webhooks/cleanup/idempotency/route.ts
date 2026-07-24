import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { cleanupExpiredIdempotencyKeys } from '@/lib/idempotency'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('IdempotencyCleanupAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for cleanup

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`Idempotency cleanup triggered (${requestId})`)

  try {
    const authError = verifyCronAuth(request, 'Idempotency key cleanup')
    if (authError) {
      return authError
    }

    const deleted = await cleanupExpiredIdempotencyKeys({
      maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
      batchSize: 1000,
    })

    return NextResponse.json({
      success: true,
      message: 'Idempotency key cleanup completed',
      requestId,
      result: { deleted },
    })
  } catch (error) {
    logger.error(`Error during idempotency cleanup (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: 'Idempotency cleanup failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      { status: 500 }
    )
  }
}
