import { db, webhook } from '@tradinggoose/db'
import { pineIndicators, workflow } from '@tradinggoose/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import {
  applyIndicatorTriggerPayloadBudget,
  buildIndicatorTriggerDispatchPayload,
  buildManualIndicatorTriggerEventId,
  resolveDispatchInterval,
  resolveLatestBarOpenTimeSec,
} from '@/lib/indicators/dispatch'
import { executeCompiledIndicator } from '@/lib/indicators/execution/compile-execution'
import { buildInputsMapFromMeta, normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import {
  INDICATOR_MONITOR_TRIGGER_ID,
  type IndicatorMonitorProviderConfig,
} from '@/lib/indicators/monitor-config'
import { mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import type { NormalizedPineSignal } from '@/lib/indicators/types'
import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  checkRateLimits,
  checkUsageLimits,
  type QueueWebhookExecutionInternalResult,
  queueWebhookExecutionInternal,
} from '@/lib/webhooks/processor'
import { blockExistsInDeployment } from '@/lib/workflows/db-helpers'
import {
  authenticateIndicatorRequest,
  getWorkspaceWritePermissionError,
  isExecutionTimeoutError,
  parseIndicatorRequestBody,
  resolveIndicatorRuntimeConfig,
} from '../utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const logger = createLogger('IndicatorExecuteAPI')
const EXECUTION_TIMEOUT_MS = 15000
const MAX_BARS = 2000

type IndicatorExecuteWarning = {
  code: string
  message: string
}

type IndicatorDispatchSkipCode =
  | 'interval_unresolved'
  | 'no_monitor_match'
  | 'no_latest_candidate'
  | 'collapsed'
  | 'gate_blocked'
  | 'payload_too_large'
  | 'queue_failed'

type IndicatorDispatchSkip = {
  code: IndicatorDispatchSkipCode
  message: string
  monitorId?: string
}

type IndicatorDispatchSummary = {
  attempted: boolean
  workflowId?: string
  executionTarget?: 'deployed' | 'live'
  monitorsMatched: number
  monitorsDispatched: number
  monitorsSkipped: number
  skipped: IndicatorDispatchSkip[]
}

type ExecuteResult = {
  indicatorId: string
  output: unknown | null
  warnings: IndicatorExecuteWarning[]
  unsupported: unknown
  counts: { plots: number; markers: number; signals: number }
  executionError?: { message: string; code: string; unsupported?: unknown }
  dispatch?: IndicatorDispatchSummary
}

type DispatchOptions =
  | { enabled: false }
  | { enabled: true; workflowId: string; executionTarget: 'deployed' | 'live' }

type IndicatorMonitorConfig = IndicatorMonitorProviderConfig['monitor']

type IndicatorMonitorRecord = {
  id: string
  path: string
  workflowId: string
  blockId: string | null
  providerConfig: IndicatorMonitorProviderConfig
  monitor: IndicatorMonitorConfig
}

const MarketBarSchema = z.object({
  timeStamp: z.string(),
  open: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  close: z.number(),
  volume: z.number().optional(),
  turnover: z.number().optional(),
})

const ListingIdentitySchema = z.object({
  listing_id: z.string(),
  base_id: z.string(),
  quote_id: z.string(),
  listing_type: z.enum(['default', 'crypto', 'currency']),
})

const MarketSeriesSchema = z.object({
  listing: ListingIdentitySchema.nullable().optional(),
  bars: z.array(MarketBarSchema).min(1, 'marketSeries.bars is required'),
})

const DispatchSchema = z.discriminatedUnion('enabled', [
  z.object({
    enabled: z.literal(false),
  }),
  z.object({
    enabled: z.literal(true),
    workflowId: z.string().min(1),
    executionTarget: z.enum(['deployed', 'live']),
  }),
])

const ExecuteSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  indicatorIds: z.array(z.string().min(1)).min(1, 'indicatorIds is required'),
  marketSeries: MarketSeriesSchema,
  interval: z.string().optional(),
  intervalMs: z.number().optional(),
  inputsMapById: z.record(z.record(z.any())).optional(),
  dispatch: DispatchSchema.optional(),
})

const toDispatchOptions = (dispatch?: z.infer<typeof DispatchSchema>): DispatchOptions =>
  dispatch?.enabled ? dispatch : { enabled: false }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const areListingsEqual = (a: ListingIdentity, b: ListingIdentity) =>
  a.listing_type === b.listing_type &&
  a.listing_id === b.listing_id &&
  a.base_id === b.base_id &&
  a.quote_id === b.quote_id

const toIndicatorMonitorRecord = (
  row: typeof webhook.$inferSelect
): IndicatorMonitorRecord | null => {
  if (!isRecord(row.providerConfig)) return null
  if (row.providerConfig.triggerId !== INDICATOR_MONITOR_TRIGGER_ID) return null
  if (!isRecord(row.providerConfig.monitor)) return null

  const monitor = row.providerConfig.monitor
  const providerId = typeof monitor.providerId === 'string' ? monitor.providerId.trim() : ''
  const interval = typeof monitor.interval === 'string' ? monitor.interval.trim() : ''
  const indicatorId = typeof monitor.indicatorId === 'string' ? monitor.indicatorId.trim() : ''
  const listing = toListingValueObject(monitor.listing as any)

  if (!providerId || !interval || !indicatorId || !listing) return null

  return {
    id: row.id,
    path: row.path,
    workflowId: row.workflowId,
    blockId: row.blockId ?? null,
    providerConfig: row.providerConfig as IndicatorMonitorProviderConfig,
    monitor: {
      ...(row.providerConfig.monitor as IndicatorMonitorConfig),
      listing,
    },
  }
}

const filterLatestCandidates = ({
  signals,
  latestBarOpenTimeSec,
}: {
  signals: NormalizedPineSignal[]
  latestBarOpenTimeSec: number | null
}) => {
  if (latestBarOpenTimeSec === null) return []
  return signals.filter((signal) => signal.time === latestBarOpenTimeSec)
}

const chooseCandidateForMonitor = ({
  signals,
}: {
  signals: NormalizedPineSignal[]
}) => {
  if (signals.length === 0) {
    return {
      candidate: null,
      collapsedCount: 0,
    }
  }

  const sorted = [...signals].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time
    if (a.event !== b.event) return a.event.localeCompare(b.event)
    return a.signal.localeCompare(b.signal)
  })

  return {
    candidate: sorted[0] ?? null,
    collapsedCount: Math.max(0, sorted.length - 1),
  }
}

const appendWarning = (warnings: IndicatorExecuteWarning[], warning: IndicatorExecuteWarning) => {
  const exists = warnings.some(
    (existing) => existing.code === warning.code && existing.message === warning.message
  )
  if (!exists) {
    warnings.push(warning)
  }
}

const appendSkip = (dispatchSummary: IndicatorDispatchSummary, skip: IndicatorDispatchSkip) => {
  dispatchSummary.skipped.push(skip)
}

const makeGateBlockedWarning = (monitorId: string, message: string): IndicatorExecuteWarning => ({
  code: 'indicator_trigger_gate_blocked',
  message: `Monitor ${monitorId} dispatch blocked by gate: ${message}`,
})

const makeQueueFailedWarning = (
  monitorId: string,
  result: QueueWebhookExecutionInternalResult
): IndicatorExecuteWarning => ({
  code: 'indicator_trigger_queue_failed',
  message: result.queued
    ? `Monitor ${monitorId} queue failed.`
    : `Monitor ${monitorId} queue failed: ${result.message}`,
})

async function loadDispatchMonitors({
  workspaceId,
  workflowId,
}: {
  workspaceId: string
  workflowId: string
}): Promise<IndicatorMonitorRecord[]> {
  const rows = await db
    .select({
      webhook,
      workflow: {
        id: workflow.id,
        workspaceId: workflow.workspaceId,
      },
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        eq(webhook.workflowId, workflowId),
        eq(webhook.provider, 'indicator'),
        eq(webhook.isActive, true)
      )
    )

  return rows
    .map((row) => toIndicatorMonitorRecord(row.webhook))
    .filter((row): row is IndicatorMonitorRecord => Boolean(row))
    .sort((a, b) => a.id.localeCompare(b.id))
}

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

    const { workspaceId, indicatorIds, interval, intervalMs } = parsedBody.data
    const dispatchOptions = toDispatchOptions(parsedBody.data.dispatch)

    const permissionError = await getWorkspaceWritePermissionError(auth.userId, workspaceId)
    if (permissionError) return permissionError

    const userSubscription = await getHighestPrioritySubscription(auth.userId)
    const { useE2B, e2bTemplate, e2bKeepWarmMs } = resolveIndicatorRuntimeConfig(
      userSubscription?.plan
    )

    const requestedMarketSeries = parsedBody.data.marketSeries
    const requestedBars = requestedMarketSeries.bars
    const barsWereTruncated = requestedBars.length > MAX_BARS
    const marketSeries = barsWereTruncated
      ? { ...requestedMarketSeries, bars: requestedBars.slice(-MAX_BARS) }
      : requestedMarketSeries
    const barsMs = mapMarketSeriesToBarsMs(marketSeries, intervalMs ?? null)
    const executionListing = toListingValueObject(marketSeries.listing ?? null)
    const latestBarOpenTimeSec = resolveLatestBarOpenTimeSec(barsMs)
    const emittedAt = new Date().toISOString()
    const dispatchInterval = dispatchOptions.enabled
      ? resolveDispatchInterval(interval, intervalMs ?? null)
      : null

    const dispatchMonitors =
      dispatchOptions.enabled && dispatchInterval
        ? await loadDispatchMonitors({
            workspaceId,
            workflowId: dispatchOptions.workflowId,
          })
        : []

    const customIndicatorIds = indicatorIds.filter((id) => !DEFAULT_INDICATOR_RUNTIME_MAP.has(id))
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

    const results = await Promise.all(
      indicatorIds.map(async (indicatorId): Promise<ExecuteResult> => {
        const customIndicator = indicatorMap.get(indicatorId)
        const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(indicatorId)

        const baseDispatchSummary: IndicatorDispatchSummary | undefined = dispatchOptions.enabled
          ? {
              attempted: false,
              workflowId: dispatchOptions.workflowId,
              executionTarget: dispatchOptions.executionTarget,
              monitorsMatched: 0,
              monitorsDispatched: 0,
              monitorsSkipped: 0,
              skipped: [],
            }
          : undefined

        if (!customIndicator && !defaultIndicator) {
          return {
            indicatorId,
            output: null,
            warnings: [{ code: 'missing_indicator', message: `${indicatorId} is missing.` }],
            unsupported: { plots: [], styles: [] },
            counts: { plots: 0, markers: 0, signals: 0 },
            executionError: { message: 'Indicator not found', code: 'missing_indicator' },
            ...(baseDispatchSummary ? { dispatch: baseDispatchSummary } : {}),
          }
        }

        const pineCode = customIndicator?.pineCode ?? defaultIndicator?.pineCode ?? ''
        const inputMeta = customIndicator
          ? normalizeInputMetaMap(customIndicator.inputMeta)
          : defaultIndicator?.inputMeta
        const indicatorName = customIndicator?.name ?? defaultIndicator?.name ?? indicatorId
        const inputsOverride = parsedBody.data.inputsMapById?.[indicatorId]
        const baseInputsMap = buildInputsMapFromMeta(inputMeta)
        const inputsMap = inputsOverride ? { ...baseInputsMap, ...inputsOverride } : baseInputsMap

        const warnings: IndicatorExecuteWarning[] = []
        if (barsWereTruncated) {
          warnings.push({
            code: 'bars_truncated',
            message: `Bars were capped to the latest ${MAX_BARS} entries for execution.`,
          })
        }

        try {
          const compiled = await executeCompiledIndicator({
            pineCode,
            barsMs,
            inputsMap,
            listing: executionListing,
            interval,
            intervalMs,
            useE2B,
            e2bTemplate,
            e2bKeepWarmMs,
            executionTimeoutMs: EXECUTION_TIMEOUT_MS,
          })

          if (compiled.unsupportedFeatures && compiled.unsupportedFeatures.length > 0) {
            return {
              indicatorId,
              output: null,
              warnings,
              unsupported: { plots: [], styles: [] },
              counts: { plots: 0, markers: 0, signals: 0 },
              executionError: {
                message: `${compiled.unsupportedFeatures[0]} is not supported`,
                code: 'unsupported_feature',
                unsupported: { features: compiled.unsupportedFeatures },
              },
              ...(baseDispatchSummary ? { dispatch: baseDispatchSummary } : {}),
            }
          }

          if (!compiled.output) {
            return {
              indicatorId,
              output: null,
              warnings,
              unsupported: compiled.unsupported ?? { plots: [], styles: [] },
              counts: { plots: 0, markers: 0, signals: 0 },
              executionError: {
                message: compiled.executionError?.message ?? 'Failed to execute indicator',
                code: 'runtime_error',
              },
              ...(baseDispatchSummary ? { dispatch: baseDispatchSummary } : {}),
            }
          }

          const output = compiled.output
          const counts = {
            plots: output.series.length,
            markers: output.markers.length,
            signals: output.signals.length,
          }

          const combinedWarnings = [...warnings, ...compiled.warnings]

          if (!dispatchOptions.enabled) {
            return {
              indicatorId,
              output,
              warnings: combinedWarnings,
              unsupported: output.unsupported,
              counts,
            }
          }

          const dispatchSummary: IndicatorDispatchSummary = {
            attempted: true,
            workflowId: dispatchOptions.workflowId,
            executionTarget: dispatchOptions.executionTarget,
            monitorsMatched: 0,
            monitorsDispatched: 0,
            monitorsSkipped: 0,
            skipped: [],
          }

          try {
            if (!dispatchInterval) {
              appendWarning(combinedWarnings, {
                code: 'indicator_trigger_dispatch_interval_unresolved',
                message: 'Dispatch interval could not be resolved from interval or intervalMs.',
              })
              appendSkip(dispatchSummary, {
                code: 'interval_unresolved',
                message: 'Dispatch interval unresolved; monitor lookup skipped.',
              })

              return {
                indicatorId,
                output,
                warnings: combinedWarnings,
                unsupported: output.unsupported,
                counts,
                dispatch: dispatchSummary,
              }
            }

            const matchingMonitors = dispatchMonitors.filter((monitorRow) => {
              if (monitorRow.providerConfig.triggerId !== INDICATOR_MONITOR_TRIGGER_ID) return false
              if (monitorRow.monitor.indicatorId !== indicatorId) return false
              if (monitorRow.monitor.interval !== dispatchInterval) return false
              if (!executionListing) return false
              if (!areListingsEqual(monitorRow.monitor.listing, executionListing)) return false
              return true
            })

            dispatchSummary.monitorsMatched = matchingMonitors.length

            if (matchingMonitors.length === 0) {
              appendSkip(dispatchSummary, {
                code: 'no_monitor_match',
                message:
                  'No active indicator monitor matched workflow, indicator, listing, and interval.',
              })
              return {
                indicatorId,
                output,
                warnings: combinedWarnings,
                unsupported: output.unsupported,
                counts,
                dispatch: dispatchSummary,
              }
            }

            const latestCandidates = filterLatestCandidates({
              signals: output.signals,
              latestBarOpenTimeSec,
            })

            for (const monitorRow of matchingMonitors) {
              if (latestCandidates.length === 0) {
                appendSkip(dispatchSummary, {
                  code: 'no_latest_candidate',
                  message: 'No latest-bar trigger candidate emitted for this monitor.',
                  monitorId: monitorRow.id,
                })
                continue
              }

              const candidateSelection = chooseCandidateForMonitor({
                signals: latestCandidates,
              })
              if (!candidateSelection.candidate) continue

              if (candidateSelection.collapsedCount > 0) {
                appendSkip(dispatchSummary, {
                  code: 'collapsed',
                  message: `Collapsed ${candidateSelection.collapsedCount} extra latest-bar candidates to one dispatch.`,
                  monitorId: monitorRow.id,
                })
              }

              const barBucketMs = candidateSelection.candidate.time * 1000
              const eventId = buildManualIndicatorTriggerEventId({
                executeRequestId: requestId,
                monitorId: monitorRow.id,
                indicatorId,
                barBucketMs,
              })

              const payload = buildIndicatorTriggerDispatchPayload({
                eventId,
                executionId: requestId,
                emittedAt,
                triggerSignal: candidateSelection.candidate,
                indicatorId,
                indicatorName,
                output,
                inputsMap,
                interval: dispatchInterval,
                intervalMs: intervalMs ?? undefined,
                marketSeries,
                monitor: {
                  id: monitorRow.id,
                  workflowId: monitorRow.workflowId,
                  blockId: monitorRow.blockId ?? '',
                  listing: monitorRow.monitor.listing,
                  providerId: monitorRow.monitor.providerId,
                  interval: monitorRow.monitor.interval,
                  indicatorId: monitorRow.monitor.indicatorId,
                },
              })

              const budgetResult = applyIndicatorTriggerPayloadBudget(payload)
              if (budgetResult.metadata.truncated) {
                appendWarning(combinedWarnings, {
                  code: 'indicator_trigger_payload_truncated',
                  message: `Monitor ${monitorRow.id} payload truncated to ${budgetResult.metadata.retainedBars} bars (${budgetResult.metadata.finalSizeBytes} bytes).`,
                })
              }

              if (budgetResult.skipped) {
                appendWarning(combinedWarnings, {
                  code: 'indicator_trigger_payload_too_large',
                  message: `Monitor ${monitorRow.id} payload exceeded maximum size after truncation.`,
                })
                appendSkip(dispatchSummary, {
                  code: 'payload_too_large',
                  message: 'Payload exceeded size budget after deterministic truncation.',
                  monitorId: monitorRow.id,
                })
                continue
              }

              const workflowRow = {
                id: monitorRow.workflowId,
                pinnedApiKeyId: null as string | null,
              }
              const [workflowDetails] = await db
                .select({
                  id: workflow.id,
                  pinnedApiKeyId: workflow.pinnedApiKeyId,
                })
                .from(workflow)
                .where(eq(workflow.id, monitorRow.workflowId))
                .limit(1)

              if (workflowDetails?.id) {
                workflowRow.id = workflowDetails.id
                workflowRow.pinnedApiKeyId = workflowDetails.pinnedApiKeyId
              }

              const webhookRow = {
                id: monitorRow.id,
                path: monitorRow.path,
                blockId: monitorRow.blockId,
                provider: 'indicator',
                providerConfig: monitorRow.providerConfig,
              }

              const rateLimitResult = await checkRateLimits(workflowRow, webhookRow, requestId)
              if (!rateLimitResult.allowed) {
                appendWarning(
                  combinedWarnings,
                  makeGateBlockedWarning(monitorRow.id, rateLimitResult.message)
                )
                appendSkip(dispatchSummary, {
                  code: 'gate_blocked',
                  message: rateLimitResult.message,
                  monitorId: monitorRow.id,
                })
                continue
              }

              const usageLimitResult = await checkUsageLimits(
                workflowRow,
                webhookRow,
                requestId,
                false
              )
              if (!usageLimitResult.allowed) {
                appendWarning(
                  combinedWarnings,
                  makeGateBlockedWarning(monitorRow.id, usageLimitResult.message)
                )
                appendSkip(dispatchSummary, {
                  code: 'gate_blocked',
                  message: usageLimitResult.message,
                  monitorId: monitorRow.id,
                })
                continue
              }

              if (
                dispatchOptions.executionTarget === 'deployed' &&
                monitorRow.blockId &&
                !(await blockExistsInDeployment(monitorRow.workflowId, monitorRow.blockId))
              ) {
                appendWarning(
                  combinedWarnings,
                  makeGateBlockedWarning(
                    monitorRow.id,
                    'Trigger block is not in active deployment.'
                  )
                )
                appendSkip(dispatchSummary, {
                  code: 'gate_blocked',
                  message: 'Trigger block is not in active deployment.',
                  monitorId: monitorRow.id,
                })
                continue
              }

              const queueResult = await queueWebhookExecutionInternal(
                webhookRow,
                workflowRow,
                budgetResult.payload,
                { kind: 'internal', headers: {} },
                {
                  requestId,
                  path: monitorRow.path,
                  testMode: false,
                  executionTarget: dispatchOptions.executionTarget,
                  headerOverrides: {
                    'x-event-id': eventId,
                  },
                }
              )

              if (!queueResult.queued) {
                appendWarning(combinedWarnings, makeQueueFailedWarning(monitorRow.id, queueResult))
                appendSkip(dispatchSummary, {
                  code: 'queue_failed',
                  message: queueResult.message,
                  monitorId: monitorRow.id,
                })
                continue
              }

              dispatchSummary.monitorsDispatched += 1
            }

            dispatchSummary.monitorsSkipped =
              dispatchSummary.monitorsMatched - dispatchSummary.monitorsDispatched

            return {
              indicatorId,
              output,
              warnings: combinedWarnings,
              unsupported: output.unsupported,
              counts,
              dispatch: dispatchSummary,
            }
          } catch (dispatchError) {
            logger.warn(`[${requestId}] Indicator dispatch failed unexpectedly`, {
              indicatorId,
              workflowId: dispatchOptions.workflowId,
              error: dispatchError,
            })
            appendWarning(combinedWarnings, {
              code: 'indicator_trigger_queue_failed',
              message: 'Indicator dispatch failed unexpectedly; indicator output was still produced.',
            })
            appendSkip(dispatchSummary, {
              code: 'queue_failed',
              message: 'Dispatch failed unexpectedly before queue completion.',
            })
            dispatchSummary.monitorsSkipped = Math.max(
              dispatchSummary.monitorsMatched - dispatchSummary.monitorsDispatched,
              0
            )
            return {
              indicatorId,
              output,
              warnings: combinedWarnings,
              unsupported: output.unsupported,
              counts,
              dispatch: dispatchSummary,
            }
          }
        } catch (error) {
          const timedOut = isExecutionTimeoutError(error)
          return {
            indicatorId,
            output: null,
            warnings,
            unsupported: { plots: [], styles: [] },
            counts: { plots: 0, markers: 0, signals: 0 },
            executionError: {
              message: timedOut ? 'Execution timed out' : 'Failed to execute indicator',
              code: timedOut ? 'timeout' : 'runtime_error',
            },
            ...(baseDispatchSummary ? { dispatch: baseDispatchSummary } : {}),
          }
        }
      })
    )

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    logger.error(`[${requestId}] Indicator execute failed`, { error })
    return NextResponse.json(
      { success: false, error: 'Failed to execute indicators' },
      { status: 500 }
    )
  }
}
