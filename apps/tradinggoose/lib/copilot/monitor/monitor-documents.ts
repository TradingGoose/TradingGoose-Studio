import { z } from 'zod'
import {
  getListingIdentitySymbol,
  ListingIdentitySchema,
  type ListingResolved,
} from '@/lib/listing/identity'
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'

export const MONITOR_DOCUMENT_FORMAT = 'tg-monitor-document-v1' as const

const RequiredStringSchema = z.string().trim().min(1)

const IndicatorMonitorDocumentSchema = z
  .object({
    source: z.literal(INDICATOR_MONITOR_PROVIDER),
    workflowId: RequiredStringSchema,
    blockId: RequiredStringSchema,
    providerId: RequiredStringSchema,
    interval: RequiredStringSchema,
    indicatorId: RequiredStringSchema,
    listing: ListingIdentitySchema,
    isActive: z.boolean(),
    providerParams: z.record(z.string(), z.unknown()).optional(),
    auth: z
      .object({
        secrets: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const PortfolioMonitorDocumentSchema = z
  .object({
    source: z.literal(PORTFOLIO_MONITOR_PROVIDER),
    workflowId: RequiredStringSchema,
    blockId: RequiredStringSchema,
    providerId: RequiredStringSchema,
    serviceId: RequiredStringSchema,
    credentialId: RequiredStringSchema,
    accountId: RequiredStringSchema,
    condition: z.unknown(),
    fireMode: z.enum(['edge', 'while_true']),
    cooldownSeconds: z.number().int().min(0),
    pollIntervalSeconds: z.number().int().min(15),
    isActive: z.boolean(),
  })
  .strict()

export const MonitorDocumentSchema = z.discriminatedUnion('source', [
  IndicatorMonitorDocumentSchema,
  PortfolioMonitorDocumentSchema,
])

export type MonitorDocumentFields = z.infer<typeof MonitorDocumentSchema>

export function parseMonitorDocument(entityDocument: string): MonitorDocumentFields {
  return MonitorDocumentSchema.parse(JSON.parse(entityDocument))
}

export function serializeMonitorDocument(
  fields: Record<string, unknown> | null | undefined
): string {
  const parsed = MonitorDocumentSchema.parse(fields)
  return JSON.stringify(parsed, null, 2)
}

export function readMonitorDocumentName(
  fields: Record<string, unknown> | null | undefined,
  resolvedListing: ListingResolved | null
): string {
  const parsed = MonitorDocumentSchema.parse(fields)
  if (parsed.source === PORTFOLIO_MONITOR_PROVIDER) {
    return `Portfolio state (${parsed.accountId})`
  }

  const listingLabel = resolvedListing
    ? parsed.listing.listing_type === 'default' || !resolvedListing.quote
      ? resolvedListing.base
      : `${resolvedListing.base}/${resolvedListing.quote}`
    : getListingIdentitySymbol(parsed.listing)
  return `${parsed.indicatorId} on ${listingLabel} (${parsed.interval})`
}
