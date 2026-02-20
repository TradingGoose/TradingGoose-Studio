import { createHash } from 'crypto'
import type {
  BarMs,
  NormalizedPineMarker,
  NormalizedPineOutput,
  NormalizedPineSignal,
} from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketSeries } from '@/providers/market/types'

const DAY_MS = 24 * 60 * 60 * 1000

const INTERVAL_MS_TO_LABEL: Record<number, string> = {
  60000: '1m',
  120000: '2m',
  180000: '3m',
  300000: '5m',
  600000: '10m',
  900000: '15m',
  1800000: '30m',
  2700000: '45m',
  3600000: '1h',
  7200000: '2h',
  10800000: '3h',
  14400000: '4h',
  86400000: '1d',
  [7 * DAY_MS]: '1w',
  [14 * DAY_MS]: '2w',
  [30 * DAY_MS]: '1mo',
  [90 * DAY_MS]: '3mo',
  [180 * DAY_MS]: '6mo',
  [365 * DAY_MS]: '12mo',
}

const INTERVAL_LABEL_TO_MS: Record<string, number> = Object.entries(INTERVAL_MS_TO_LABEL).reduce<
  Record<string, number>
>((acc, [ms, label]) => {
  acc[label] = Number(ms)
  return acc
}, {})

const RETAINED_BAR_STEPS = [1000, 500, 250, 100, 50] as const

export const MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES = 262_144

type MonitorDispatchMetadata = {
  truncated: boolean
  originalSizeBytes: number
  finalSizeBytes: number
  retainedBars: number
}

type DispatchNormalizedOutput = Omit<NormalizedPineOutput, 'signals' | 'unsupported'> & {
  signals?: NormalizedPineOutput['signals']
  unsupported?: NormalizedPineOutput['unsupported']
}

export type IndicatorTriggerDispatchPayload = {
  input: string
  event: string
  eventId: string
  time: number
  signal: 'long' | 'short' | 'flat'
  triggerMarker: NormalizedPineMarker
  marketSeries: MarketSeries
  indicator: {
    id: string
    name: string
    barIndex: number
    settings: {
      inputs: Record<string, unknown>
      options?: Record<string, unknown>
      interval?: string
      intervalMs?: number
      listingKey?: string
    }
    output: DispatchNormalizedOutput
  }
  monitor: {
    id: string
    workflowId: string
    blockId: string
    listing: ListingIdentity
    providerId: string
    interval: string
    indicatorId: string
  }
  trigger: {
    provider: 'indicator'
    source: 'indicator_trigger'
    executionId: string
    emittedAt: string
  }
  monitorDispatch: MonitorDispatchMetadata
}

const toSha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const serializeSizeBytes = (payload: unknown): number =>
  Buffer.byteLength(JSON.stringify(payload), 'utf8')

const dedupeMarker = (
  markers: NormalizedPineMarker[],
  marker: NormalizedPineMarker
): NormalizedPineMarker[] => {
  const exists = markers.some(
    (entry) =>
      entry.time === marker.time &&
      entry.position === marker.position &&
      entry.shape === marker.shape &&
      entry.text === marker.text &&
      entry.color === marker.color
  )
  if (exists) {
    return markers
  }
  return [...markers, marker]
}

const sliceSeriesOutput = (
  output: DispatchNormalizedOutput,
  retainedBars: number
): DispatchNormalizedOutput => ({
  ...output,
  series: output.series.map((entry) => ({
    ...entry,
    points: entry.points.slice(-retainedBars),
  })),
  markers: output.markers.slice(-retainedBars),
})

const trimOptionalHeavyFields = (payload: IndicatorTriggerDispatchPayload) => {
  const nextPayload = {
    ...payload,
    marketSeries: { ...payload.marketSeries },
    indicator: {
      ...payload.indicator,
      output: {
        ...payload.indicator.output,
      },
    },
  }

  const { marketSessions: _marketSessions, ...marketSeriesWithoutSessions } =
    nextPayload.marketSeries
  const {
    signals: _signals,
    unsupported: _unsupported,
    ...outputWithoutHeavyFields
  } = nextPayload.indicator.output

  return {
    ...nextPayload,
    marketSeries: marketSeriesWithoutSessions,
    indicator: {
      ...nextPayload.indicator,
      output: outputWithoutHeavyFields,
    },
  }
}

const resolveListingParts = (listing: ListingIdentity | null | undefined) => {
  if (!listing) {
    return {
      listingBase: undefined,
      listingQuote: undefined,
    }
  }

  if (listing.listing_type === 'default') {
    return {
      listingBase: listing.listing_id || undefined,
      listingQuote: undefined,
    }
  }

  return {
    listingBase: listing.base_id || undefined,
    listingQuote: listing.quote_id || undefined,
  }
}

export const resolveDispatchInterval = (
  interval: string | undefined,
  intervalMs: number | null | undefined
): string | null => {
  const trimmedInterval = typeof interval === 'string' ? interval.trim() : ''
  if (trimmedInterval.length > 0) {
    return trimmedInterval
  }

  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs)) {
    return null
  }

  return INTERVAL_MS_TO_LABEL[intervalMs] ?? null
}

export const resolveDispatchIntervalMs = (interval: string | null | undefined): number | null => {
  if (!interval) return null
  return INTERVAL_LABEL_TO_MS[interval] ?? null
}

export const resolveLatestBarOpenTimeSec = (barsMs: BarMs[]): number | null => {
  if (!Array.isArray(barsMs) || barsMs.length === 0) return null

  let latestMs = Number.NEGATIVE_INFINITY
  barsMs.forEach((bar) => {
    if (Number.isFinite(bar.openTime) && bar.openTime > latestMs) {
      latestMs = bar.openTime
    }
  })

  if (!Number.isFinite(latestMs)) return null
  return Math.floor(latestMs / 1000)
}

export const createTriggerMarkerFromSignal = (
  signal: NormalizedPineSignal
): NormalizedPineMarker => ({
  text: signal.event,
  color: signal.color,
  position: signal.position,
  shape: signal.signal === 'long' ? 'arrowUp' : signal.signal === 'short' ? 'arrowDown' : 'circle',
  time: signal.time,
})

export const buildManualIndicatorTriggerEventId = ({
  executeRequestId,
  monitorId,
  indicatorId,
  barBucketMs,
}: {
  executeRequestId: string
  monitorId: string
  indicatorId: string
  barBucketMs: number
}) =>
  toSha256Hex(
    `indicator_trigger_manual|${executeRequestId}|${monitorId}|${indicatorId}|${barBucketMs}`
  )

export const buildLiveIndicatorTriggerEventId = ({
  monitorId,
  indicatorId,
  barBucketMs,
}: {
  monitorId: string
  indicatorId: string
  barBucketMs: number
}) => toSha256Hex(`indicator_trigger_live|${monitorId}|${indicatorId}|${barBucketMs}`)

export const applyIndicatorTriggerPayloadBudget = (
  payload: IndicatorTriggerDispatchPayload
): {
  payload: IndicatorTriggerDispatchPayload
  metadata: MonitorDispatchMetadata
  skipped: boolean
} => {
  const originalSizeBytes = serializeSizeBytes(payload)

  let currentPayload: IndicatorTriggerDispatchPayload = {
    ...payload,
    marketSeries: {
      ...payload.marketSeries,
      bars: Array.isArray(payload.marketSeries.bars) ? [...payload.marketSeries.bars] : [],
    },
    indicator: {
      ...payload.indicator,
      output: {
        ...payload.indicator.output,
        series: payload.indicator.output.series.map((entry) => ({
          ...entry,
          points: [...entry.points],
        })),
        markers: [...payload.indicator.output.markers],
        ...(payload.indicator.output.signals
          ? { signals: [...payload.indicator.output.signals] }
          : {}),
      },
    },
  }

  let finalSizeBytes = originalSizeBytes
  let retainedBars = Array.isArray(currentPayload.marketSeries.bars)
    ? currentPayload.marketSeries.bars.length
    : 0
  let truncated = false

  if (finalSizeBytes > MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES) {
    for (const step of RETAINED_BAR_STEPS) {
      currentPayload = {
        ...currentPayload,
        marketSeries: {
          ...currentPayload.marketSeries,
          bars: currentPayload.marketSeries.bars.slice(-step),
        },
        indicator: {
          ...currentPayload.indicator,
          output: sliceSeriesOutput(currentPayload.indicator.output, step),
        },
      }

      retainedBars = Math.min(step, currentPayload.marketSeries.bars.length)
      finalSizeBytes = serializeSizeBytes(currentPayload)
      truncated = true

      if (finalSizeBytes <= MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES) {
        break
      }
    }
  }

  if (finalSizeBytes > MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES) {
    currentPayload = trimOptionalHeavyFields(currentPayload)
    finalSizeBytes = serializeSizeBytes(currentPayload)
    truncated = true
  }

  if (finalSizeBytes > MAX_INDICATOR_TRIGGER_PAYLOAD_BYTES) {
    return {
      payload: {
        ...currentPayload,
        monitorDispatch: {
          truncated: true,
          originalSizeBytes,
          finalSizeBytes,
          retainedBars,
        },
      },
      metadata: {
        truncated: true,
        originalSizeBytes,
        finalSizeBytes,
        retainedBars,
      },
      skipped: true,
    }
  }

  return {
    payload: {
      ...currentPayload,
      monitorDispatch: {
        truncated,
        originalSizeBytes,
        finalSizeBytes,
        retainedBars,
      },
    },
    metadata: {
      truncated,
      originalSizeBytes,
      finalSizeBytes,
      retainedBars,
    },
    skipped: false,
  }
}

export const buildIndicatorTriggerDispatchPayload = ({
  eventId,
  executionId,
  emittedAt,
  triggerSignal,
  indicatorId,
  indicatorName,
  output,
  inputsMap,
  interval,
  intervalMs,
  listingKey,
  marketSeries,
  monitor,
}: {
  eventId: string
  executionId: string
  emittedAt: string
  triggerSignal: NormalizedPineSignal
  indicatorId: string
  indicatorName: string
  output: NormalizedPineOutput
  inputsMap: Record<string, unknown>
  interval?: string
  intervalMs?: number
  listingKey?: string
  marketSeries: MarketSeries
  monitor: {
    id: string
    workflowId: string
    blockId: string
    listing: ListingIdentity
    providerId: string
    interval: string
    indicatorId: string
  }
}): IndicatorTriggerDispatchPayload => {
  const triggerMarker = createTriggerMarkerFromSignal(triggerSignal)
  const mergedOutput: DispatchNormalizedOutput = {
    ...output,
    markers: dedupeMarker(output.markers, triggerMarker),
  }
  const listingParts = resolveListingParts(marketSeries.listing ?? undefined)

  return {
    input: triggerSignal.input,
    event: triggerSignal.event,
    eventId,
    time: triggerSignal.time,
    signal: triggerSignal.signal,
    triggerMarker,
    marketSeries: {
      ...marketSeries,
      listingBase: marketSeries.listingBase ?? listingParts.listingBase,
      listingQuote: marketSeries.listingQuote ?? listingParts.listingQuote,
    },
    indicator: {
      id: indicatorId,
      name: indicatorName,
      barIndex: triggerSignal.barIndex,
      settings: {
        inputs: inputsMap,
        options: output.indicator as Record<string, unknown> | undefined,
        interval,
        intervalMs,
        listingKey,
      },
      output: mergedOutput,
    },
    monitor,
    trigger: {
      provider: 'indicator',
      source: 'indicator_trigger',
      executionId,
      emittedAt,
    },
    monitorDispatch: {
      truncated: false,
      originalSizeBytes: 0,
      finalSizeBytes: 0,
      retainedBars: marketSeries.bars.length,
    },
  }
}
