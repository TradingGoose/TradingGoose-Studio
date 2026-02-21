import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { getStableVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('IndicatorsOperations')

interface UpsertIndicatorsParams {
  indicators: Array<{
    id?: string
    name: string
    color?: string
    pineCode: string
    inputMeta?: Record<string, unknown>
  }>
  workspaceId: string
  userId: string
  requestId?: string
}

const resolveIndicatorColor = (
  input: string | null | undefined,
  indicatorId: string,
  fallback?: string | null
): string => {
  if (typeof input === 'string' && input.trim().length > 0) {
    return input.trim()
  }
  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    return fallback.trim()
  }
  return getStableVibrantColor(indicatorId)
}

export async function upsertIndicators({
  indicators,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: UpsertIndicatorsParams) {
  return await db.transaction(async (tx) => {
    for (const indicator of indicators) {
      const nowTime = new Date()

      if (indicator.id) {
        const existing = await tx
          .select()
          .from(pineIndicators)
          .where(
            and(eq(pineIndicators.id, indicator.id), eq(pineIndicators.workspaceId, workspaceId))
          )
          .limit(1)

        if (existing.length > 0) {
          const existingColor = existing[0]?.color
          const nextColor = resolveIndicatorColor(indicator.color, indicator.id, existingColor)

          await tx
            .update(pineIndicators)
            .set({
              name: indicator.name,
              color: nextColor,
              pineCode: indicator.pineCode,
              inputMeta: indicator.inputMeta ?? null,
              updatedAt: nowTime,
            })
            .where(eq(pineIndicators.id, indicator.id))

          logger.info(`[${requestId}] Updated Indicator ${indicator.id}`)
          continue
        }
      }

      const indicatorId = indicator.id ?? crypto.randomUUID()
      const nextColor = resolveIndicatorColor(indicator.color, indicatorId)

      await tx.insert(pineIndicators).values({
        id: indicatorId,
        workspaceId,
        userId,
        name: indicator.name,
        color: nextColor,
        pineCode: indicator.pineCode,
        inputMeta: indicator.inputMeta ?? null,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      logger.info(`[${requestId}] Created Indicator ${indicator.name}`)
    }

    return await tx
      .select()
      .from(pineIndicators)
      .where(eq(pineIndicators.workspaceId, workspaceId))
      .orderBy(desc(pineIndicators.createdAt))
  })
}
