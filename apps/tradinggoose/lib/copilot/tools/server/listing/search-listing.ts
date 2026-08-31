import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import { getListingIdentityKey, type ListingResolved } from '@/lib/listing/identity'
import { fetchListings } from '@/lib/listing/search'

type SearchListingArgs = {
  query: string
}

export const searchListingServerTool: BaseServerTool<
  SearchListingArgs,
  { results: ListingResolved[] }
> = {
  name: 'search_listing',
  async execute(args: SearchListingArgs, context?: ServerToolExecutionContext) {
    const query = args.query.trim()
    if (!query) {
      throw new Error('query is required')
    }

    throwIfServerToolAborted(context)
    try {
      const listings = await fetchListings({ search_query: query }, context?.signal)
      throwIfServerToolAborted(context)

      const seen = new Set<string>()
      const results: ListingResolved[] = []
      for (const listing of listings) {
        const key = getListingIdentityKey(listing.listingIdentity)
        if (seen.has(key)) continue

        seen.add(key)
        results.push(listing)
      }

      return { results }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }

      throw new StructuredServerToolError({
        status: 502,
        body: {
          code: 'search_listing_backend_failed',
          error: 'Listing search failed while querying the market listing search service.',
          hint: "Retry with the company name, ticker, or pair symbol. In watchlist listing items, put the selected result's listingIdentity under the listing key.",
          retryable: true,
        },
      })
    }
  },
}
