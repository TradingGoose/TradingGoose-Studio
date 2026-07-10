import { z } from 'zod'
import {
  createTradingGooseExportFile,
  type TradingGooseExportEnvelope,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import type { WatchlistDocumentFields, WatchlistDocumentInputFields } from '@/lib/watchlists/types'
import {
  normalizePersistedWatchlistDocumentFields,
  normalizeWatchlistDocumentFields,
  WatchlistDocumentSchema,
} from '@/lib/watchlists/validation'

export const WATCHLIST_EXPORT_SOURCE = 'watchlistWidget'

export type WatchlistImportFile = TradingGooseExportEnvelope & {
  watchlists: [WatchlistDocumentFields]
}

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
