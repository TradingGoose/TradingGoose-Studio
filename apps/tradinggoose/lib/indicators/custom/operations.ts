import { db } from '@tradinggoose/db'
import { customIndicators } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { getRandomVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('CustomIndicatorsOperations')

interface UpsertCustomIndicatorsParams {
  indicators: Array<{
    id?: string
    name: string
    color?: string
    calcCode: string
  }>
  workspaceId: string
  userId: string
  requestId?: string
}

const resolveIndicatorColor = (
  input: string | null | undefined,
  fallback?: string | null
): string => {
  if (typeof input === 'string' && input.trim().length > 0) {
    return input.trim()
  }
  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    return fallback.trim()
  }
  return getRandomVibrantColor()
}

/**
 * Create or update custom indicators scoped to a workspace.
 */
export async function upsertCustomIndicators({
  indicators,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: UpsertCustomIndicatorsParams) {
  return await db.transaction(async (tx) => {
    for (const indicator of indicators) {
      const nowTime = new Date()

      if (indicator.id) {
        const existing = await tx
          .select()
          .from(customIndicators)
          .where(
            and(eq(customIndicators.id, indicator.id), eq(customIndicators.workspaceId, workspaceId))
          )
          .limit(1)

        if (existing.length > 0) {
          const existingColor = existing[0]?.color
          const nextColor = resolveIndicatorColor(indicator.color, existingColor)

          await tx
            .update(customIndicators)
            .set({
              name: indicator.name,
              color: nextColor,
              calcCode: indicator.calcCode,
              updatedAt: nowTime,
            })
            .where(eq(customIndicators.id, indicator.id))

          logger.info(`[${requestId}] Updated custom indicator ${indicator.id}`)
          continue
        }
      }

      const nextColor = resolveIndicatorColor(indicator.color)

      await tx.insert(customIndicators).values({
        ...(indicator.id ? { id: indicator.id } : null),
        workspaceId,
        userId,
        name: indicator.name,
        color: nextColor,
        calcCode: indicator.calcCode,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      logger.info(`[${requestId}] Created custom indicator ${indicator.name}`)
    }

    return await tx
      .select()
      .from(customIndicators)
      .where(eq(customIndicators.workspaceId, workspaceId))
      .orderBy(desc(customIndicators.createdAt))
  })
}
