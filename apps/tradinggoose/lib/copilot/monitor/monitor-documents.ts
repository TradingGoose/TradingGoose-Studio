import { z } from 'zod'
import { ListingIdentityPassthroughSchema } from '@/lib/listing/identity'
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'

export const MONITOR_DOCUMENT_FORMAT = 'tg-monitor-document-v1' as const

const IndicatorMonitorDocumentSchema = z.object({
  source: z.literal(INDICATOR_MONITOR_PROVIDER),
  workflowId: z.string(),
  blockId: z.string(),
  providerId: z.string(),
  interval: z.string(),
  indicatorId: z.string(),
  listing: ListingIdentityPassthroughSchema,
  isActive: z.boolean(),
  providerParams: z.record(z.unknown()).optional(),
  auth: z
    .object({
      secrets: z.record(z.string()).optional(),
    })
    .optional(),
})

const PortfolioMonitorDocumentSchema = z.object({
  source: z.literal(PORTFOLIO_MONITOR_PROVIDER),
  workflowId: z.string(),
  blockId: z.string(),
  providerId: z.string(),
  serviceId: z.string(),
  credentialId: z.string(),
  accountId: z.string(),
  condition: z.unknown(),
  fireMode: z.enum(['edge', 'while_true']),
  cooldownSeconds: z.number().int().min(0),
  pollIntervalSeconds: z.number().int().min(15),
  isActive: z.boolean(),
})

export const MonitorDocumentSchema = z.discriminatedUnion('source', [
  IndicatorMonitorDocumentSchema,
  PortfolioMonitorDocumentSchema,
])

export type MonitorDocumentFields = z.infer<typeof MonitorDocumentSchema>
type IndicatorMonitorDocumentFields = z.infer<typeof IndicatorMonitorDocumentSchema>

function normalizeRecord(
  record: Record<string, unknown> | null | undefined
): MonitorDocumentFields {
  const source = record ?? {}
  const monitorSource = source.source
  if (
    monitorSource !== INDICATOR_MONITOR_PROVIDER &&
    monitorSource !== PORTFOLIO_MONITOR_PROVIDER
  ) {
    throw new Error('Monitor document source is required.')
  }
  if (monitorSource === PORTFOLIO_MONITOR_PROVIDER) {
    return {
      source: PORTFOLIO_MONITOR_PROVIDER,
      workflowId: typeof source.workflowId === 'string' ? source.workflowId : '',
      blockId: typeof source.blockId === 'string' ? source.blockId : '',
      providerId: typeof source.providerId === 'string' ? source.providerId : '',
      serviceId: typeof source.serviceId === 'string' ? source.serviceId : '',
      credentialId: typeof source.credentialId === 'string' ? source.credentialId : '',
      accountId: typeof source.accountId === 'string' ? source.accountId : '',
      condition: source.condition ?? null,
      fireMode: source.fireMode === 'while_true' ? 'while_true' : 'edge',
      cooldownSeconds:
        typeof source.cooldownSeconds === 'number' && Number.isFinite(source.cooldownSeconds)
          ? source.cooldownSeconds
          : 300,
      pollIntervalSeconds:
        typeof source.pollIntervalSeconds === 'number' &&
        Number.isFinite(source.pollIntervalSeconds)
          ? source.pollIntervalSeconds
          : 60,
      isActive: typeof source.isActive === 'boolean' ? source.isActive : true,
    }
  }

  const listingSource =
    source.listing && typeof source.listing === 'object' && !Array.isArray(source.listing)
      ? (source.listing as Record<string, unknown>)
      : {}
  const authSource =
    source.auth && typeof source.auth === 'object' && !Array.isArray(source.auth)
      ? (source.auth as Record<string, unknown>)
      : null

  return {
    source: INDICATOR_MONITOR_PROVIDER,
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
    ...(authSource?.secrets && typeof authSource.secrets === 'object'
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

function getListingLabel(listing: IndicatorMonitorDocumentFields['listing']): string {
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

export function readMonitorDocumentName(
  fields: Record<string, unknown> | null | undefined
): string {
  const parsed = normalizeRecord(fields)
  if (parsed.source === PORTFOLIO_MONITOR_PROVIDER) {
    return `Portfolio state (${parsed.accountId || 'account'})`
  }

  const listingLabel = getListingLabel(parsed.listing)
  const indicatorLabel = parsed.indicatorId || 'indicator'
  const intervalLabel = parsed.interval || 'interval'
  return `${indicatorLabel} on ${listingLabel} (${intervalLabel})`
}
