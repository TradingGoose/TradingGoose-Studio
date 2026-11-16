import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CronAuth')

/**
 * Verify CRON authentication for scheduled API endpoints
 * Returns null if authorized, or a NextResponse with error if unauthorized
 */
export function verifyCronAuth(request: NextRequest, context?: string): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  const expectedAuth = `Bearer ${env.CRON_SECRET}`
  if (authHeader !== expectedAuth) {
    const contextInfo = context ? ` for ${context}` : ''
    logger.warn(`Unauthorized CRON access attempt${contextInfo}`, {
      providedAuth: authHeader,
      ip: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      context,
    })

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
