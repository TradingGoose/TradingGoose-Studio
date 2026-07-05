import { z } from 'zod'
import {
  createTradingGooseExportFile,
  type TradingGooseExportEnvelope,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import { ListingIdentitySchema } from '@/lib/listing/identity'
import {
  normalizePersistedWatchlistDocumentFields,
  normalizeWatchlistDocumentFields,
} from '@/lib/watchlists/validation'
import type {
  WatchlistDocumentFields,
  WatchlistDocumentInputFields,
} from '@/lib/watchlists/types'

export const WATCHLIST_EXPORT_SOURCE = 'watchlistWidget'

export type WatchlistImportFile = TradingGooseExportEnvelope & {
  watchlists: [WatchlistDocumentFields]
}

const normalizeString = (value: string) => value.trim()

const WatchlistSettingsSchema = z
  .object({
    showLogo: z.boolean(),
    showTicker: z.boolean(),
    showDescription: z.boolean(),
  })
  .strict()

const WatchlistDocumentListingItemSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('listing'),
    listing: ListingIdentitySchema,
  })
  .strict()

const WatchlistDocumentSectionItemSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('section'),
    label: z
      .string()
      .transform(normalizeString)
      .pipe(z.string().min(1, 'Section label is required')),
  })
  .strict()

const WatchlistDocumentItemSchema = z.union([
  WatchlistDocumentListingItemSchema,
  WatchlistDocumentSectionItemSchema,
])

export const WatchlistDocumentSchema = z
  .object({
    name: z
      .string()
      .transform(normalizeString)
      .pipe(z.string().min(1, 'Watchlist name is required')),
    settings: WatchlistSettingsSchema,
    items: z.array(WatchlistDocumentItemSchema),
  })
  .strict()

export const WatchlistImportFileSchema = TradingGooseExportEnvelopeSchema.extend({
  watchlists: z.tuple([WatchlistDocumentSchema]),
}).superRefine((value, ctx) => {
  if (!value.resourceTypes.includes('watchlists')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceTypes must include watchlists',
      path: ['resourceTypes'],
    })
  }
})

export function parseImportedWatchlistFile(input: unknown): WatchlistDocumentInputFields {
  const parsed = WatchlistImportFileSchema.parse(input)
  return normalizeWatchlistDocumentFields(parsed.watchlists[0])
}

export function createWatchlistExportFile({
  fields,
  exportedFrom = WATCHLIST_EXPORT_SOURCE,
}: {
  fields: WatchlistDocumentFields
  exportedFrom?: string
}): WatchlistImportFile {
  const watchlist = normalizePersistedWatchlistDocumentFields(fields)

  return createTradingGooseExportFile({
    exportedFrom,
    resourceTypes: ['watchlists'],
    resources: {
      watchlists: [watchlist],
    },
  }) as WatchlistImportFile
}

export function exportWatchlistAsJson({
  fields,
  exportedFrom,
}: {
  fields: WatchlistDocumentFields
  exportedFrom?: string
}): string {
  return JSON.stringify(createWatchlistExportFile({ fields, exportedFrom }), null, 2)
}
