import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { normalizeOptionalString } from '@/lib/utils'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const MONITOR_FIELDS = ['id', 'providerId', 'interval', 'indicatorId'] as const
const MONITOR_LISTING_FIELDS = [
  'listing_type',
  'listing_id',
  'base_id',
  'quote_id',
  'assetClass',
  'base_asset_class',
] as const

const pickStringFields = (record: Record<string, unknown>, fields: readonly string[]) =>
  Object.fromEntries(
    fields.flatMap((field) => {
      const value = normalizeOptionalString(record[field])
      return value ? [[field, value]] : []
    })
  )

/**
 * Parses a JSON-encoded listing filter string into a ListingIdentity.
 * Returns `undefined` when the input is empty/missing and `null` when parsing fails.
 */
export const parseListingFilter = (
  value: string | undefined
): ListingIdentity | undefined | null => {
  const normalized = normalizeOptionalString(value)
  if (!normalized) return undefined

  try {
    const parsed = JSON.parse(normalized)
    return toListingValueObject(parsed)
  } catch {
    return null
  }
}

export const toLogExecutionDataRecord = (value: unknown) => (isRecord(value) ? value : null)

const toPublicMonitorTrigger = (storedExecutionData: Record<string, unknown>) => {
  const trigger = storedExecutionData.trigger
  if (!isRecord(trigger) || trigger.source !== 'indicator_trigger') return undefined

  const data = trigger.data
  if (!isRecord(data) || !isRecord(data.monitor)) return undefined

  const monitor: Record<string, unknown> = pickStringFields(data.monitor, MONITOR_FIELDS)
  const listing = isRecord(data.monitor.listing)
    ? pickStringFields(data.monitor.listing, MONITOR_LISTING_FIELDS)
    : undefined

  if (listing && Object.keys(listing).length > 0) {
    monitor.listing = listing
  }

  return Object.keys(monitor).length > 0
    ? { source: 'indicator_trigger', data: { monitor } }
    : undefined
}

export const buildPublicLogExecutionData = ({
  storedExecutionData,
  totalDuration,
  traceSpans,
  blockExecutions,
  finalOutput,
}: {
  storedExecutionData: Record<string, unknown>
  totalDuration: number | null
  traceSpans: unknown
  blockExecutions: unknown
  finalOutput: unknown
}) => {
  const trigger = toPublicMonitorTrigger(storedExecutionData)

  return {
    totalDuration,
    traceSpans,
    blockExecutions,
    finalOutput,
    enhanced: true,
    ...(trigger ? { trigger } : {}),
  }
}
