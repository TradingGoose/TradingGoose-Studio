import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { getStableVibrantColor } from '@/lib/colors'
import {
  type IndicatorTransferRecord,
  resolveImportedIndicatorName,
} from '@/lib/indicators/import-export'
import { inferInputMetaFromPineCode } from '@/lib/indicators/input-meta'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { readSavedEntityListFieldsForExecution } from '@/lib/yjs/server/bootstrap-review-target'
import type { EntityListBeforeInsert } from '@/lib/yjs/server/entity-loaders'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'

const logger = createLogger('IndicatorsOperations')

export async function listCustomIndicatorRuntimeEntries(
  workspaceId: string,
  isDeployedContext: boolean
) {
  const entries = await readSavedEntityListFieldsForExecution(
    'indicator',
    workspaceId,
    isDeployedContext
  )
  return entries.map(({ entityId, entityName, fields }) => {
    const pineCode = String(fields.pineCode ?? '')
    return {
      id: entityId,
      pineCode,
      inputMeta: inferInputMetaFromPineCode(pineCode),
    }
  })
}

export async function listIndicators(params: { workspaceId: string }) {
  const entries = await readSavedEntityListFieldsForExecution(
    'indicator',
    params.workspaceId,
    false
  )
  return entries.map(({ entityId, entityName, fields }) => {
    const pineCode = String(fields.pineCode ?? '')
    return {
      id: entityId,
      workspaceId: params.workspaceId,
      userId: null,
      name: entityName,
      color: String(fields.color ?? ''),
      pineCode,
      inputMeta: inferInputMetaFromPineCode(pineCode),
    }
  })
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
  beforeInsert?: EntityListBeforeInsert
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
  beforeInsert,
}: CreateIndicatorsParams) {
  if (indicators.length === 0) {
    return []
  }

  const created = await db.transaction(async (tx) => {
    await beforeInsert?.(tx)
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
        createdAt: nowTime,
        updatedAt: nowTime,
      })
    }

    const createdIndicators = await tx.insert(pineIndicators).values(insertValues).returning()
    return createdIndicators
  })

  await refreshEntityListSession('indicator', workspaceId)
  logger.info(`[${requestId}] Created ${created.length} indicator(s)`)
  return created
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

  await refreshEntityListSession('indicator', workspaceId)
  logger.info(`[${requestId}] Imported ${result.indicators.length} indicator(s)`, {
    workspaceId,
    renamedCount: result.renamedCount,
  })
  return result
}
