import { db } from '@tradinggoose/db'
import { webhook } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  applyIndicatorTriggerPayloadBudget,
  buildIndicatorTriggerDispatchPayload,
  buildLiveIndicatorTriggerEventId,
  resolveLatestBarOpenTimeSec,
} from '@/lib/indicators/dispatch'
import { executeCompiledIndicator } from '@/lib/indicators/execution/compile-execution'
import { normalizeBarsMs } from '@/lib/indicators/series-data'
import type { BarMs, NormalizedPineSignal } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { withExecutionConcurrencyLimit } from '@/lib/execution/execution-concurrency-limit'
import { createLogger } from '@/lib/logs/console/logger'
import {
  loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution,
} from '@/lib/workflows/execution-runner'
import type { MarketSeries } from '@/providers/market/types'

const logger = createLogger('IndicatorMonitorExecution')

type IndicatorMonitorExecutionMonitor = {
  id: string
  workflowId: string
  workspaceId: string
  userId: string
  actorUserId: string
  blockId: string
  providerId: 'alpaca' | 'finnhub'
  interval: string
  intervalMs: number | null
  indicatorId: string
  listing: ListingIdentity
}

type IndicatorMonitorExecutionIndicator = {
  id: string
  name: string
  pineCode: string
}

export type IndicatorMonitorExecutionPayload = {
  executionId?: string
  monitor: IndicatorMonitorExecutionMonitor
  indicator: IndicatorMonitorExecutionIndicator
  inputsMap: Record<string, unknown>
  bars: BarMs[]
  marketCode?: string
  timezone?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const isMonitor = (value: unknown): value is IndicatorMonitorExecutionMonitor => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.workflowId === 'string' &&
    typeof value.workspaceId === 'string' &&
    typeof value.userId === 'string' &&
    typeof value.actorUserId === 'string' &&
    typeof value.blockId === 'string' &&
    (value.providerId === 'alpaca' || value.providerId === 'finnhub') &&
    typeof value.interval === 'string' &&
    (typeof value.intervalMs === 'number' || value.intervalMs === null) &&
    typeof value.indicatorId === 'string' &&
    isRecord(value.listing)
  )
}

const isIndicator = (
  value: unknown,
): value is IndicatorMonitorExecutionIndicator => {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.pineCode === 'string'
  )
}

export function isIndicatorMonitorExecutionPayload(
  value: unknown,
): value is IndicatorMonitorExecutionPayload {
  if (!isRecord(value)) {
    return false
  }

  return (
    isMonitor(value.monitor) &&
    isIndicator(value.indicator) &&
    isRecord(value.inputsMap) &&
    Array.isArray(value.bars)
  )
}

const toMarketSeries = ({
  bars,
  listing,
  marketCode,
  timezone,
}: {
  bars: BarMs[]
  listing: ListingIdentity
  marketCode?: string
  timezone?: string
}): MarketSeries => {
  const listingBase =
    listing.listing_type === 'default' ? listing.listing_id : listing.base_id
  const listingQuote =
    listing.listing_type === 'default' ? undefined : listing.quote_id

  return {
    listing,
    listingBase,
    listingQuote,
    marketCode,
    timezone,
    start: bars[0] ? new Date(bars[0].openTime).toISOString() : undefined,
    end: bars[bars.length - 1]
      ? new Date(bars[bars.length - 1].openTime).toISOString()
      : undefined,
    bars: bars.map((bar) => ({
      timeStamp: new Date(bar.openTime).toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    })),
  }
}

const chooseCandidate = ({
  triggers,
  latestBarOpenTimeSec,
}: {
  triggers: NormalizedPineSignal[]
  latestBarOpenTimeSec: number | null
}): NormalizedPineSignal | null => {
  if (latestBarOpenTimeSec === null) {
    return null
  }

  const latestCandidates = triggers.filter(
    (signal) => signal.time === latestBarOpenTimeSec,
  )
  if (latestCandidates.length === 0) {
    return null
  }

  return [...latestCandidates].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time
    if (a.event !== b.event) return a.event.localeCompare(b.event)
    return a.signal.localeCompare(b.signal)
  })[0] ?? null
}

async function disableMonitor(
  monitorId: string,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  await db
    .update(webhook)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(and(eq(webhook.id, monitorId), eq(webhook.provider, 'indicator')))

  logger.warn('Indicator monitor disabled', {
    monitorId,
    reason,
    ...metadata,
  })
}

export async function executeIndicatorMonitorJob(
  payload: IndicatorMonitorExecutionPayload,
) {
  const requestId = (payload.executionId ?? payload.monitor.id).slice(0, 8)
  const bars = normalizeBarsMs(payload.bars, payload.monitor.intervalMs ?? undefined)

  logger.info(`[${requestId}] Starting indicator monitor execution`, {
    monitorId: payload.monitor.id,
    workflowId: payload.monitor.workflowId,
    actorUserId: payload.monitor.actorUserId,
  })

  return withExecutionConcurrencyLimit({
    userId: payload.monitor.actorUserId,
    workflowId: payload.monitor.workflowId,
    workspaceId: payload.monitor.workspaceId,
    task: async () => {
      const compiled = await executeCompiledIndicator({
        pineCode: payload.indicator.pineCode,
        barsMs: bars,
        inputsMap: payload.inputsMap,
        listing: payload.monitor.listing,
        interval: payload.monitor.interval,
        intervalMs: payload.monitor.intervalMs,
        executionTimeoutMs: 15_000,
        userId: payload.monitor.userId,
      })

      if (!compiled.output) {
        return { success: true, skipped: 'no_output' as const }
      }

      const candidate = chooseCandidate({
        triggers: compiled.output.triggers,
        latestBarOpenTimeSec: resolveLatestBarOpenTimeSec(bars),
      })
      if (!candidate) {
        return { success: true, skipped: 'no_candidate' as const }
      }

      const barBucketMs = candidate.time * 1000
      const eventId = buildLiveIndicatorTriggerEventId({
        monitorId: payload.monitor.id,
        indicatorId: payload.monitor.indicatorId,
        barBucketMs,
      })

      const marketSeries = toMarketSeries({
        bars,
        listing: payload.monitor.listing,
        marketCode: payload.marketCode,
        timezone: payload.timezone,
      })

      const dispatchPayload = buildIndicatorTriggerDispatchPayload({
        eventId,
        executionId: eventId,
        emittedAt: new Date().toISOString(),
        triggerSignal: candidate,
        indicatorId: payload.monitor.indicatorId,
        indicatorName: payload.indicator.name,
        output: compiled.output,
        inputsMap: payload.inputsMap,
        interval: payload.monitor.interval,
        intervalMs: payload.monitor.intervalMs ?? undefined,
        marketSeries,
        monitor: {
          id: payload.monitor.id,
          workflowId: payload.monitor.workflowId,
          blockId: payload.monitor.blockId,
          listing: payload.monitor.listing,
          providerId: payload.monitor.providerId,
          interval: payload.monitor.interval,
          indicatorId: payload.monitor.indicatorId,
        },
      })

      const budgetResult = applyIndicatorTriggerPayloadBudget(dispatchPayload)
      if (budgetResult.skipped) {
        logger.warn('Indicator monitor dispatch skipped: payload too large', {
          monitorId: payload.monitor.id,
          workflowId: payload.monitor.workflowId,
          originalSizeBytes: budgetResult.metadata.originalSizeBytes,
          finalSizeBytes: budgetResult.metadata.finalSizeBytes,
          retainedBars: budgetResult.metadata.retainedBars,
        })
        return { success: true, skipped: 'payload_too_large' as const }
      }

      if (budgetResult.metadata.truncated) {
        logger.warn('Indicator monitor payload truncated', {
          monitorId: payload.monitor.id,
          workflowId: payload.monitor.workflowId,
          originalSizeBytes: budgetResult.metadata.originalSizeBytes,
          finalSizeBytes: budgetResult.metadata.finalSizeBytes,
          retainedBars: budgetResult.metadata.retainedBars,
        })
      }

      const usageCheck = await checkServerSideUsageLimits({
        userId: payload.monitor.actorUserId,
        workflowId: payload.monitor.workflowId,
        workspaceId: payload.monitor.workspaceId,
      })
      if (usageCheck.isExceeded) {
        await disableMonitor(payload.monitor.id, 'usage_limit_exceeded', {
          workflowId: payload.monitor.workflowId,
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
        })
        return { success: true, skipped: 'usage_limit_exceeded' as const }
      }

      const blueprint = await loadWorkflowExecutionBlueprint({
        workflowId: payload.monitor.workflowId,
        executionTarget: 'deployed',
      })
      const blocks = blueprint.workflowData.blocks as Record<string, unknown>
      if (!blocks[payload.monitor.blockId]) {
        await disableMonitor(payload.monitor.id, 'missing_trigger_block', {
          workflowId: payload.monitor.workflowId,
          blockId: payload.monitor.blockId,
        })
        return { success: true, skipped: 'missing_trigger_block' as const }
      }

      const { result } = await runPreparedWorkflowExecution({
        blueprint,
        actorUserId: payload.monitor.actorUserId,
        requestId,
        executionId: eventId,
        triggerType: 'webhook',
        workflowInput: budgetResult.payload,
        start: {
          kind: 'block',
          blockId: payload.monitor.blockId,
        },
        triggerData: {
          source: 'indicator_trigger',
          executionTarget: 'deployed',
          monitor: {
            id: payload.monitor.id,
            workflowId: payload.monitor.workflowId,
            blockId: payload.monitor.blockId,
            listing: payload.monitor.listing,
            providerId: payload.monitor.providerId,
            interval: payload.monitor.interval,
            indicatorId: payload.monitor.indicatorId,
          },
        },
        concurrencyLeaseInherited: true,
      })

      logger.info(`[${requestId}] Indicator monitor execution completed`, {
        success: result.success,
        monitorId: payload.monitor.id,
        workflowId: payload.monitor.workflowId,
      })

      return {
        success: result.success,
        workflowId: payload.monitor.workflowId,
        executionId: eventId,
        output: result.output,
        error: result.error,
        executedAt: new Date().toISOString(),
        provider: 'indicator',
      }
    },
  })
}
