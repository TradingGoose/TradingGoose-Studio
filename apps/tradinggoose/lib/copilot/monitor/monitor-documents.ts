import { z } from 'zod'

export const MONITOR_DOCUMENT_FORMAT = 'tg-monitor-document-v1' as const

const MonitorListingSchema = z
  .object({
    listing_type: z.enum(['default', 'crypto', 'currency']),
    listing_id: z.string(),
    base_id: z.string(),
    quote_id: z.string(),
  })
  .passthrough()

export const MonitorDocumentSchema = z.object({
  workflowId: z.string(),
  blockId: z.string(),
  providerId: z.string(),
  interval: z.string(),
  indicatorId: z.string(),
  listing: MonitorListingSchema,
  isActive: z.boolean(),
  providerParams: z.record(z.unknown()).optional(),
  auth: z
    .object({
      secrets: z.record(z.string()).optional(),
    })
    .optional(),
})

export type MonitorDocumentFields = z.infer<typeof MonitorDocumentSchema>

function normalizeRecord(record: Record<string, unknown> | null | undefined): MonitorDocumentFields {
  const source = record ?? {}
  const listingSource =
    source.listing && typeof source.listing === 'object' && !Array.isArray(source.listing)
      ? (source.listing as Record<string, unknown>)
      : {}
  const authSource =
    source.auth && typeof source.auth === 'object' && !Array.isArray(source.auth)
      ? (source.auth as Record<string, unknown>)
      : null

  return {
    workflowId: typeof source.workflowId === 'string' ? source.workflowId : '',
    blockId: typeof source.blockId === 'string' ? source.blockId : '',
    providerId: typeof source.providerId === 'string' ? source.providerId : '',
    interval: typeof source.interval === 'string' ? source.interval : '',
    indicatorId: typeof source.indicatorId === 'string' ? source.indicatorId : '',
    listing: {
      listing_type:
        listingSource.listing_type === 'default' ||
        listingSource.listing_type === 'crypto' ||
        listingSource.listing_type === 'currency'
          ? listingSource.listing_type
          : 'default',
      listing_id: typeof listingSource.listing_id === 'string' ? listingSource.listing_id : '',
      base_id: typeof listingSource.base_id === 'string' ? listingSource.base_id : '',
      quote_id: typeof listingSource.quote_id === 'string' ? listingSource.quote_id : '',
      ...listingSource,
    },
    isActive: typeof source.isActive === 'boolean' ? source.isActive : true,
    ...(source.providerParams &&
    typeof source.providerParams === 'object' &&
    !Array.isArray(source.providerParams)
      ? { providerParams: source.providerParams as Record<string, unknown> }
      : {}),
    ...(authSource && authSource.secrets && typeof authSource.secrets === 'object'
      ? {
          auth: {
            secrets: Object.fromEntries(
              Object.entries(authSource.secrets as Record<string, unknown>).map(([key, value]) => [
                key,
                typeof value === 'string' ? value : String(value ?? ''),
              ])
            ),
          },
        }
      : {}),
  }
}

export function parseMonitorDocument(entityDocument: string): MonitorDocumentFields {
  const parsedJson = JSON.parse(entityDocument)
  return MonitorDocumentSchema.parse(normalizeRecord(parsedJson))
}

export function serializeMonitorDocument(
  fields: Record<string, unknown> | null | undefined
): string {
  const parsed = MonitorDocumentSchema.parse(normalizeRecord(fields))
  return JSON.stringify(parsed, null, 2)
}

function getListingLabel(listing: MonitorDocumentFields['listing']): string {
  const anyListing = listing as Record<string, unknown>
  const name = typeof anyListing.name === 'string' ? anyListing.name.trim() : ''
  if (name) return name

  if (listing.listing_type === 'default') {
    return listing.listing_id || 'listing'
  }

  const base = listing.base_id || ''
  const quote = listing.quote_id || ''
  return base && quote ? `${base}/${quote}` : base || quote || 'listing'
}

export function getMonitorDocumentName(
  fields: Record<string, unknown> | null | undefined
): string {
  const parsed = normalizeRecord(fields)
  const listingLabel = getListingLabel(parsed.listing)
  const indicatorLabel = parsed.indicatorId || 'indicator'
  const intervalLabel = parsed.interval || 'interval'
  return `${indicatorLabel} on ${listingLabel} (${intervalLabel})`
}
