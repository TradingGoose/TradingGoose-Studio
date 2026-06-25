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
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'

const logger = createLogger('IndicatorsOperations')

export async function listCustomIndicatorRuntimeEntries(workspaceId: string) {
  const rows = await db
    .select()
    .from(pineIndicators)
    .where(eq(pineIndicators.workspaceId, workspaceId))

  return rows.map(({ id, pineCode, inputMeta }) => ({
    id,
    pineCode,
    inputMeta: normalizeInputMetaMap(inputMeta),
  }))
}

interface CreateIndicatorsParams {
  indicators: Array<{
    name: string
    color?: string
    pineCode: string
    inputMeta?: Record<string, unknown>
  }>
  workspaceId: string
  userId: string
  requestId?: string
}

interface SaveIndicatorParams {
  indicator: {
    id: string
    name: string
    pineCode: string
    inputMeta?: Record<string, unknown>
  }
  workspaceId: string
  requestId?: string
}

interface ImportIndicatorsParams {
  indicators: IndicatorTransferRecord[]
  workspaceId: string
  userId: string
  requestId?: string
}

export async function createIndicators({
  indicators,
  workspaceId,
  userId,
  requestId = generateRequestId(),
}: CreateIndicatorsParams) {
  if (indicators.length === 0) {
    return []
  }

  return await db.transaction(async (tx) => {
    const nowTime = new Date()
    const insertValues = []

    for (const indicator of indicators) {
      const indicatorId = crypto.randomUUID()
      insertValues.push({
        id: indicatorId,
        workspaceId,
        userId,
        name: indicator.name,
        color: indicator.color?.trim() || getStableVibrantColor(indicatorId),
        pineCode: indicator.pineCode,
        inputMeta: indicator.inputMeta ?? null,
        createdAt: nowTime,
        updatedAt: nowTime,
      })
    }

    const createdIndicators = await tx.insert(pineIndicators).values(insertValues).returning()
    logger.info(`[${requestId}] Created ${createdIndicators.length} indicator(s)`)
    return createdIndicators
  })
}

export async function saveIndicator({
  indicator,
  workspaceId,
  requestId = generateRequestId(),
}: SaveIndicatorParams) {
  const [existing] = await db
    .select({
      id: pineIndicators.id,
      color: pineIndicators.color,
    })
    .from(pineIndicators)
    .where(and(eq(pineIndicators.id, indicator.id), eq(pineIndicators.workspaceId, workspaceId)))
    .limit(1)

  if (!existing) {
    throw new Error(`Indicator ${indicator.id} was not found`)
  }

  await applySavedEntityState('indicator', indicator.id, {
    name: indicator.name,
    color: existing.color ?? getStableVibrantColor(indicator.id),
    pineCode: indicator.pineCode,
    inputMeta: indicator.inputMeta ?? null,
  })
  logger.info(`[${requestId}] Saved Indicator ${indicator.id}`)
  return db
    .select()
    .from(pineIndicators)
    .where(eq(pineIndicators.workspaceId, workspaceId))
    .orderBy(desc(pineIndicators.createdAt))
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

  return result
}
