import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '@/lib/indicators/default/runtime'
import { isIndicatorTriggerCapable } from '@/lib/indicators/trigger-detection'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '../utils'

const logger = createLogger('IndicatorOptionsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
})

type IndicatorOptionRecord = {
  id: string
  name: string
  source: 'default' | 'custom'
  color: string
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'options list',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { searchParams } = new URL(request.url)
    const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams.entries()))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'workspaceId is required' },
        { status: 400 }
      )
    }

    const { workspaceId } = parsed.data
    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const defaultOptions: IndicatorOptionRecord[] = DEFAULT_INDICATOR_RUNTIME_ENTRIES.filter(
      (entry) => isIndicatorTriggerCapable(entry.pineCode)
    ).map((entry) => ({
      id: entry.id,
      name: entry.name,
      source: 'default',
      color: '#3972F6',
    }))

    const customRows = await db
      .select({
        id: pineIndicators.id,
        name: pineIndicators.name,
        color: pineIndicators.color,
        pineCode: pineIndicators.pineCode,
      })
      .from(pineIndicators)
      .where(eq(pineIndicators.workspaceId, workspaceId))

    const customOptions: IndicatorOptionRecord[] = customRows
      .filter((row) => isIndicatorTriggerCapable(row.pineCode))
      .map((row) => ({
        id: row.id,
        name: row.name,
        source: 'custom',
        color: row.color?.trim() || '#3972F6',
      }))

    const merged = [...defaultOptions, ...customOptions].sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    return NextResponse.json({ data: merged }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to list indicator options`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
