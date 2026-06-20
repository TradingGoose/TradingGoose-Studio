import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { getStableVibrantColor } from '@/lib/colors'
import {
  type IndicatorTransferRecord,
  resolveImportedIndicatorName,
} from '@/lib/indicators/import-export'
import { normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  applySavedEntityYjsStateToRows,
  seedSavedEntityYjsStateFromRows,
} from '@/lib/yjs/entity-state'

const logger = createLogger('IndicatorsOperations')

export async function listCustomIndicatorRuntimeEntries(workspaceId: string) {
  const rows = await db
    .select()
    .from(pineIndicators)
    .where(eq(pineIndicators.workspaceId, workspaceId))
    .then((indicatorRows) => applySavedEntityYjsStateToRows('indicator', indicatorRows))

  return rows.map(({ id, pineCode, inputMeta }) => ({
    id,
    pineCode,
    inputMeta: normalizeInputMetaMap(inputMeta),
  }))
}

interface UpsertIndicatorsParams {
  indicators: Array<{
    id?: string
    name: string
    pineCode: string
    inputMeta?: Record<string, unknown>
  }>
  workspaceId: string
  userId: string
  requestId?: string
}

interface ImportIndicatorsParams {
  indicators: IndicatorTransferRecord[]
  workspaceId: string
  userId: string
  requestId?: string
}

export async function upsertIndicators({
  indicators,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: UpsertIndicatorsParams) {
  const affectedIds: string[] = []
  const result = await db.transaction(async (tx) => {
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

          await tx
            .update(pineIndicators)
            .set({
              name: indicator.name,
              color: existingColor ?? getStableVibrantColor(indicator.id),
              pineCode: indicator.pineCode,
              inputMeta: indicator.inputMeta ?? null,
              updatedAt: nowTime,
            })
            .where(eq(pineIndicators.id, indicator.id))

          logger.info(`[${requestId}] Updated Indicator ${indicator.id}`)
          affectedIds.push(indicator.id)
          continue
        }
      }

      const indicatorId = indicator.id ?? crypto.randomUUID()
      await tx.insert(pineIndicators).values({
        id: indicatorId,
        workspaceId,
        userId,
        name: indicator.name,
        color: getStableVibrantColor(indicatorId),
        pineCode: indicator.pineCode,
        inputMeta: indicator.inputMeta ?? null,
        createdAt: nowTime,
        updatedAt: nowTime,
      })

      logger.info(`[${requestId}] Created Indicator ${indicator.name}`)
      affectedIds.push(indicatorId)
    }

    return tx
      .select()
      .from(pineIndicators)
      .where(eq(pineIndicators.workspaceId, workspaceId))
      .orderBy(desc(pineIndicators.createdAt))
  })

  await seedSavedEntityYjsStateFromRows(
    'indicator',
    result.filter((row) => affectedIds.includes(row.id))
  )

  return applySavedEntityYjsStateToRows('indicator', result)
}

export async function importIndicators({
  indicators,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: ImportIndicatorsParams) {
  const result = await db.transaction(async (tx) => {
    const existingIndicators = await tx
      .select({ name: pineIndicators.name })
      .from(pineIndicators)
      .where(eq(pineIndicators.workspaceId, workspaceId))

    const usedNames = new Set(existingIndicators.map((indicator) => indicator.name.trim()))
    const nowTime = new Date()
    let renamedCount = 0

    const importValues = indicators.map((indicator) => {
      const nextName = resolveImportedIndicatorName(indicator.name, usedNames)
      if (nextName !== indicator.name) {
        renamedCount += 1
      }

      usedNames.add(nextName)

      const indicatorId = crypto.randomUUID()

      return {
        id: indicatorId,
        workspaceId,
        userId,
        name: nextName,
        color: getStableVibrantColor(indicatorId),
        pineCode: indicator.pineCode,
        inputMeta: indicator.inputMeta ?? null,
        createdAt: nowTime,
        updatedAt: nowTime,
      }
    })

    const importedIndicators = await tx.insert(pineIndicators).values(importValues).returning()

    logger.info(`[${requestId}] Imported ${importedIndicators.length} indicator(s)`, {
      workspaceId,
      renamedCount,
    })

    return {
      indicators: importedIndicators,
      importedCount: importedIndicators.length,
      renamedCount,
    }
  })

  await seedSavedEntityYjsStateFromRows('indicator', result.indicators)

  return result
}
