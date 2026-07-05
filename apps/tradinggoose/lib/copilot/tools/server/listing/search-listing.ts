import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
} from '@/lib/copilot/tools/server/base-tool'
import type { ListingIdentity } from '@/lib/listing/identity'
import { searchListingIdentities } from '@/components/listing-selector/fetchers'

type SearchListingArgs = {
  query: string
}

export const searchListingServerTool: BaseServerTool<
  SearchListingArgs,
  ListingIdentity[]
> = {
  name: 'search_listing',
  async execute(args: SearchListingArgs, context?: ServerToolExecutionContext) {
    const query = args.query.trim()
    if (!query) {
      throw new Error('query is required')
    }

    throwIfServerToolAborted(context)
    try {
      const listings = await searchListingIdentities(query, context?.signal)
      throwIfServerToolAborted(context)
      return listings
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }

      throw new StructuredServerToolError({
        status: 502,
        body: {
          code: 'search_listing_backend_failed',
          error: 'Listing search failed while querying the market listing search service.',
          hint: 'Retry with the company name, ticker, or pair symbol. Use the returned listingIdentity exactly in saved entity documents.',
          retryable: true,
        },
      })
    }
  },
}
