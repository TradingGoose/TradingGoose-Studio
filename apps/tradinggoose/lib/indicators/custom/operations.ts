import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { getStableVibrantColor } from '@/lib/colors'
import {
  type IndicatorTransferRecord,
  resolveImportedIndicatorName,
} from '@/lib/indicators/import-export'
import { inferInputMetaFromPineCode, normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  applySavedEntityState,
  publishCreatedSavedEntityListMembers,
} from '@/lib/yjs/server/apply-entity-state'
import { requireSavedEntityRealtimeListFields } from '@/lib/yjs/server/bootstrap-review-target'

const logger = createLogger('IndicatorsOperations')

export async function listPersistedCustomIndicatorRuntimeEntries(workspaceId: string) {
  const rows = await db
    .select({
      id: pineIndicators.id,
      pineCode: pineIndicators.pineCode,
      inputMeta: pineIndicators.inputMeta,
    })
    .from(pineIndicators)
    .where(eq(pineIndicators.workspaceId, workspaceId))

  return rows.map((row) => ({
    id: row.id,
    pineCode: row.pineCode,
    inputMeta: normalizeInputMetaMap(row.inputMeta),
  }))
}

export async function listIndicators(params: { workspaceId: string }) {
  const entries = await requireSavedEntityRealtimeListFields('indicator', params.workspaceId)
  return entries.map(({ entityId, fields }) => ({
    id: entityId,
    workspaceId: params.workspaceId,
    userId: null,
    name: String(fields.name ?? ''),
    color: String(fields.color ?? '') || undefined,
    pineCode: String(fields.pineCode ?? ''),
    inputMeta: normalizeInputMetaMap(fields.inputMeta),
  }))
}

interface CreateIndicatorsParams {
  indicators: Array<{
    name: string
    color?: string
    pineCode: string
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

  const created = await db.transaction(async (tx) => {
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
        inputMeta: inferInputMetaFromPineCode(indicator.pineCode) ?? null,
        createdAt: nowTime,
        updatedAt: nowTime,
      })
    }

    const createdIndicators = await tx.insert(pineIndicators).values(insertValues).returning()
    return createdIndicators
  })

  await publishCreatedSavedEntityListMembers(
    'indicator',
    workspaceId,
    created.map((createdIndicator) => ({
      id: createdIndicator.id,
      name: createdIndicator.name,
      color: createdIndicator.color,
    }))
  )
  logger.info(`[${requestId}] Created ${created.length} indicator(s)`)
  return created
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
  })
  logger.info(`[${requestId}] Saved Indicator ${indicator.id}`)
  return listIndicators({ workspaceId })
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
        inputMeta: inferInputMetaFromPineCode(indicator.pineCode) ?? null,
        createdAt: nowTime,
        updatedAt: nowTime,
      }
    })

    const importedIndicators = await tx.insert(pineIndicators).values(importValues).returning()

    return {
      indicators: importedIndicators,
      importedCount: importedIndicators.length,
      renamedCount,
    }
  })

  await publishCreatedSavedEntityListMembers(
    'indicator',
    workspaceId,
    result.indicators.map((imported) => ({
      id: imported.id,
      name: imported.name,
      color: imported.color,
    }))
  )
  logger.info(`[${requestId}] Imported ${result.indicators.length} indicator(s)`, {
    workspaceId,
    renamedCount: result.renamedCount,
  })
  return result
}
