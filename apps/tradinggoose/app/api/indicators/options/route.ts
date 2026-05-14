import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '@/lib/indicators/default/runtime'
import { normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import type { InputMetaMap } from '@/lib/indicators/types'
import { isIndicatorTriggerCapable } from '@/lib/indicators/trigger-detection'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { applySavedEntityYjsStateToRows } from '@/lib/yjs/entity-state'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '../utils'

const logger = createLogger('IndicatorOptionsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const QuerySchema = z.object({
  workspaceId: z.string().min(1),
  surface: z.enum(['monitor', 'copilot']).optional(),
})

type IndicatorOptionRecord = {
  id: string
  name: string
  source: 'default' | 'custom'
  color: string
  editable?: boolean
  callableInFunctionBlock?: boolean
  inputTitles?: string[]
  inputMeta?: InputMetaMap
  entityId?: string
  runtimeId?: string
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

    const { workspaceId, surface } = parsed.data
    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const copilotSurface = surface === 'copilot'

    const defaultOptions: IndicatorOptionRecord[] = DEFAULT_INDICATOR_RUNTIME_ENTRIES.filter(
      (entry) => copilotSurface || isIndicatorTriggerCapable(entry.pineCode)
    ).map((entry) => {
      const inputMeta = entry.inputMeta
      const inputTitles = Object.keys(inputMeta ?? {})

      return {
        id: entry.id,
        name: entry.name,
        source: 'default',
        color: '#3972F6',
        editable: false,
        callableInFunctionBlock: true,
        inputTitles,
        ...(inputMeta && inputTitles.length > 0 ? { inputMeta } : {}),
        runtimeId: entry.id,
      }
    })

    const customRows = await db
      .select({
        id: pineIndicators.id,
        workspaceId: pineIndicators.workspaceId,
        name: pineIndicators.name,
        color: pineIndicators.color,
        pineCode: pineIndicators.pineCode,
        inputMeta: pineIndicators.inputMeta,
      })
      .from(pineIndicators)
      .where(eq(pineIndicators.workspaceId, workspaceId))
      .then((rows) => applySavedEntityYjsStateToRows('indicator', rows))

    const customOptions: IndicatorOptionRecord[] = customRows
      .filter((row) => copilotSurface || isIndicatorTriggerCapable(row.pineCode))
      .map((row) => {
        const inputMeta = normalizeInputMetaMap(row.inputMeta)
        const inputTitles = Object.keys(inputMeta ?? {})

        return {
          id: row.id,
          name: row.name,
          source: 'custom',
          color: row.color?.trim() || '#3972F6',
          editable: true,
          callableInFunctionBlock: false,
          inputTitles,
          ...(inputMeta && inputTitles.length > 0 ? { inputMeta } : {}),
          entityId: row.id,
        }
      })

    const merged = [...defaultOptions, ...customOptions].sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    return NextResponse.json({ data: merged }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to list indicator options`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
