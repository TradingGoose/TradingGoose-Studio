import { db } from '@tradinggoose/db'
import { pineIndicators } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { compileIndicator } from '@/lib/indicators/custom/compile'
import { DEFAULT_INDICATOR_MAP } from '@/lib/indicators/default'
import { buildInputsMapFromMeta, normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import type { BarMs } from '@/lib/indicators/types'
import { generateRequestId } from '@/lib/utils'
import {
  authenticateIndicatorRequest,
  getWorkspaceWritePermissionError,
  isExecutionTimeoutError,
  parseIndicatorRequestBody,
  resolveIndicatorRuntimeConfig,
  runWithExecutionTimeout,
} from '../utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const logger = createLogger('IndicatorExecuteAPI')
const EXECUTION_TIMEOUT_MS = 15000
const MAX_BARS = 2000

const BarSchema = z.object({
  openTime: z.number(),
  closeTime: z.number().optional(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
})

const ExecuteSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  indicatorIds: z.array(z.string().min(1)).min(1, 'indicatorIds is required'),
  barsMs: z.array(BarSchema).min(1, 'barsMs is required'),
  listingKey: z.string().optional(),
  interval: z.string().optional(),
  intervalMs: z.number().optional(),
  inputsMapById: z.record(z.record(z.any())).optional(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'execute',
    })
    if ('response' in auth) return auth.response

    const parsedBody = await parseIndicatorRequestBody({ request, schema: ExecuteSchema })
    if ('response' in parsedBody) return parsedBody.response

    const { workspaceId, indicatorIds, listingKey, interval, intervalMs } = parsedBody.data
    const { useE2B, e2bTemplate, e2bKeepWarmMs, e2bReuseKey } = resolveIndicatorRuntimeConfig(
      auth.userId,
      workspaceId
    )

    const permissionError = await getWorkspaceWritePermissionError(auth.userId, workspaceId)
    if (permissionError) return permissionError

    const requestedBars = parsedBody.data.barsMs as BarMs[]
    const barsWereTruncated = requestedBars.length > MAX_BARS
    const barsMs = barsWereTruncated ? requestedBars.slice(-MAX_BARS) : requestedBars

    const customIndicatorIds = indicatorIds.filter((id) => !DEFAULT_INDICATOR_MAP.has(id))
    const storedIndicators =
      customIndicatorIds.length > 0
        ? await db
          .select()
          .from(pineIndicators)
          .where(
            and(
              eq(pineIndicators.workspaceId, workspaceId),
              inArray(pineIndicators.id, customIndicatorIds)
            )
          )
        : []

    const indicatorMap = new Map(storedIndicators.map((indicator) => [indicator.id, indicator]))

    const results: Array<{
      indicatorId: string
      output: any | null
      warnings: Array<{ code: string; message: string }>
      unsupported: { plots: string[]; styles: string[] }
      counts: { plots: number; markers: number; drawings: number; signals: number }
      executionError?: { message: string; code?: string; unsupported?: { features: string[] } }
    }> = []

    for (const indicatorId of indicatorIds) {
      const indicator = indicatorMap.get(indicatorId)
      const defaultIndicator = DEFAULT_INDICATOR_MAP.get(indicatorId)
      const resolvedIndicator = indicator ?? (defaultIndicator ? { ...defaultIndicator } : null)

      if (!resolvedIndicator) {
        results.push({
          indicatorId,
          output: null,
          warnings: [{ code: 'missing_indicator', message: `${indicatorId} is missing.` }],
          unsupported: { plots: [], styles: [] },
          counts: { plots: 0, markers: 0, drawings: 0, signals: 0 },
          executionError: { message: 'Indicator not found', code: 'missing_indicator' },
        })
        continue
      }

      const inputMeta = normalizeInputMetaMap(resolvedIndicator.inputMeta)
      const inputsOverride = parsedBody.data.inputsMapById?.[indicatorId]
      const baseInputsMap = buildInputsMapFromMeta(inputMeta)
      const inputsMap = inputsOverride ? { ...baseInputsMap, ...inputsOverride } : baseInputsMap

      const warnings: Array<{ code: string; message: string }> = []
      if (barsWereTruncated) {
        warnings.push({
          code: 'bars_truncated',
          message: `Bars were capped to the latest ${MAX_BARS} entries for execution.`,
        })
      }

      try {
        const compiled = await runWithExecutionTimeout(
          compileIndicator({
            pineCode: resolvedIndicator.pineCode ?? '',
            barsMs,
            inputsMap,
            listingKey,
            interval,
            intervalMs: intervalMs ?? null,
            useE2B,
            executionTimeoutMs: EXECUTION_TIMEOUT_MS,
            e2bTemplate,
            e2bReuseKey,
            e2bKeepWarmMs,
          }),
          EXECUTION_TIMEOUT_MS
        )

        if (compiled.unsupportedFeatures && compiled.unsupportedFeatures.length > 0) {
          results.push({
            indicatorId,
            output: null,
            warnings,
            unsupported: { plots: [], styles: [] },
            counts: { plots: 0, markers: 0, drawings: 0, signals: 0 },
            executionError: {
              message: `${compiled.unsupportedFeatures[0]} is not supported`,
              code: 'unsupported_feature',
              unsupported: { features: compiled.unsupportedFeatures },
            },
          })
          continue
        }

        if (!compiled.output) {
          results.push({
            indicatorId,
            output: null,
            warnings,
            unsupported: compiled.unsupported ?? { plots: [], styles: [] },
            counts: { plots: 0, markers: 0, drawings: 0, signals: 0 },
            executionError: {
              message: compiled.executionError?.message ?? 'Failed to execute indicator',
              code: 'runtime_error',
            },
          })
          continue
        }

        const output = compiled.output
        const counts = {
          plots: output.series.length,
          markers: output.markers.length,
          drawings: output.drawings.length,
          signals: output.signals.length,
        }

        results.push({
          indicatorId,
          output,
          warnings: [...warnings, ...compiled.warnings],
          unsupported: output.unsupported,
          counts,
        })
      } catch (error) {
        const timedOut = isExecutionTimeoutError(error)
        results.push({
          indicatorId,
          output: null,
          warnings,
          unsupported: { plots: [], styles: [] },
          counts: { plots: 0, markers: 0, drawings: 0, signals: 0 },
          executionError: {
            message: timedOut ? 'Execution timed out' : 'Failed to execute indicator',
            code: timedOut ? 'timeout' : 'runtime_error',
          },
        })
      }
    }

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    logger.error(`[${requestId}] Indicator execute failed`, { error })
    return NextResponse.json(
      { success: false, error: 'Failed to execute indicators' },
      { status: 500 }
    )
  }
}
