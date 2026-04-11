import { z } from 'zod'
import {
  createTradingGooseExportFile,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import type { ListingIdentity } from '@/lib/listing/identity'
import type {
  WatchlistImportFile,
  WatchlistImportFileItem,
  WatchlistImportFileListingItem,
  WatchlistItem,
  WatchlistTransferRecord,
} from '@/lib/watchlists/types'
import {
  normalizeListingIdentity,
  normalizeWatchlistItems,
  normalizeWatchlistName,
} from '@/lib/watchlists/validation'

const WATCHLIST_EXPORT_SOURCE = 'watchlistWidget'
const normalizeString = (value: string) => value.trim()

const ListingIdentitySchema = z
  .unknown()
  .transform((value, ctx): ListingIdentity | typeof z.NEVER => {
    const listing = normalizeListingIdentity(value)

    if (!listing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid listing',
      })
      return z.NEVER
    }

    return listing
  })

const WatchlistImportFileListingItemSchema = z
  .object({
    type: z.literal('listing'),
    listing: ListingIdentitySchema,
  })
  .strict()

const WatchlistImportFileSectionSchema = z
  .object({
    type: z.literal('section'),
    label: z
      .string()
      .transform(normalizeString)
      .pipe(z.string().min(1, 'Section label is required')),
    items: z.array(WatchlistImportFileListingItemSchema),
  })
  .strict()

const WatchlistImportFileItemSchema = z.union([
  WatchlistImportFileListingItemSchema,
  WatchlistImportFileSectionSchema,
])

const WatchlistTransferSchema = z
  .object({
    name: z
      .string()
      .transform(normalizeString)
      .pipe(z.string().min(1, 'Watchlist name is required')),
    items: z.array(WatchlistImportFileItemSchema),
  })
  .strict()

export const WatchlistImportFileSchema = TradingGooseExportEnvelopeSchema.extend({
  watchlists: z.array(WatchlistTransferSchema).length(1, 'Exactly one watchlist is required'),
}).superRefine((value, ctx) => {
  if (!value.resourceTypes.includes('watchlists')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceTypes must include watchlists',
      path: ['resourceTypes'],
    })
  }
})

const toWatchlistImportFileListingItem = (
  item: Extract<WatchlistItem, { type: 'listing' }>
): WatchlistImportFileListingItem => ({
  type: 'listing',
  listing: item.listing,
})

const toWatchlistImportFileItems = (items: WatchlistItem[]): WatchlistImportFileItem[] => {
  const output: WatchlistImportFileItem[] = []
  let currentSection: Extract<WatchlistImportFileItem, { type: 'section' }> | null = null

  for (const item of items) {
    if (item.type === 'section') {
      currentSection = {
        type: 'section',
        label: item.label,
        items: [],
      }
      output.push(currentSection)
      continue
    }

    if (currentSection) {
      currentSection.items.push(toWatchlistImportFileListingItem(item))
      continue
    }

    output.push(toWatchlistImportFileListingItem(item))
  }

  return output
}

export function parseImportedWatchlistFile(input: unknown): WatchlistImportFile {
  return WatchlistImportFileSchema.parse(input) as WatchlistImportFile
}

export function createWatchlistExportFile({
  name,
  items,
}: {
  name: string
  items: unknown
}): WatchlistImportFile {
  const watchlist: WatchlistTransferRecord = {
    name: normalizeWatchlistName(name),
    items: toWatchlistImportFileItems(normalizeWatchlistItems(items)),
  }

  return createTradingGooseExportFile({
    exportedFrom: WATCHLIST_EXPORT_SOURCE,
    resourceTypes: ['watchlists'],
    resources: {
      watchlists: [watchlist],
    },
  }) as WatchlistImportFile
}

export function exportWatchlistAsJson({ name, items }: { name: string; items: unknown }): string {
  return JSON.stringify(createWatchlistExportFile({ name, items }), null, 2)
}
