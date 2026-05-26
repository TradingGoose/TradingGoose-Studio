import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import {
  addListingToWatchlist,
  getWatchlist,
  listWatchlists,
  removeListingFromWatchlist,
  WatchlistOperationError,
} from '@/lib/watchlists/operations'
import type {
  WatchlistItem,
  WatchlistListingItem,
  WatchlistRecord,
  WatchlistSectionItem,
} from '@/lib/watchlists/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('WatchlistToolsAPI')

const nonEmptyString = z.string().trim().min(1)

const listingSchema = z
  .object({
    listing_id: z.string(),
    base_id: z.string(),
    quote_id: z.string(),
    listing_type: z.enum(['default', 'crypto', 'currency']),
  })
  .passthrough()

const baseSchema = z.object({
  workspaceId: nonEmptyString,
})

const watchlistToolRequestSchema = z.discriminatedUnion('operation', [
  baseSchema.extend({ operation: z.literal('readLists') }),
  baseSchema.extend({
    operation: z.literal('readListItems'),
    watchlistId: nonEmptyString,
  }),
  baseSchema.extend({
    operation: z.literal('addListing'),
    watchlistId: nonEmptyString,
    listing: listingSchema,
  }),
  baseSchema.extend({
    operation: z.literal('removeListing'),
    watchlistId: nonEmptyString,
    listing: listingSchema,
  }),
])

type WatchlistToolRequest = z.infer<typeof watchlistToolRequestSchema>

type WatchlistToolScope = {
  workspaceId: string
  userId: string
}

const errorResponse = (message: string, status = 400) =>
  NextResponse.json({ success: false, error: { message } }, { status })

const splitWatchlistItems = (items: WatchlistItem[]) => {
  const listings: WatchlistListingItem[] = []
  const sections: WatchlistSectionItem[] = []

  for (const item of items) {
    if (item.type === 'listing') {
      listings.push(item)
    } else {
      sections.push(item)
    }
  }

  return { items, listings, sections }
}

const watchlistData = (watchlist: WatchlistRecord) => ({
  watchlist,
  ...splitWatchlistItems(watchlist.items),
})

const requireWorkspaceAccess = async (userId: string, workspaceId: string, needsWrite: boolean) => {
  const access = await checkWorkspaceAccess(workspaceId, userId)

  if (!access.exists || !access.hasAccess) {
    throw new WatchlistOperationError('Access denied', 403)
  }

  if (needsWrite && !access.canWrite) {
    throw new WatchlistOperationError('Write permission required', 403)
  }
}

const dispatchWatchlistOperation = async (
  scope: WatchlistToolScope,
  body: WatchlistToolRequest
) => {
  switch (body.operation) {
    case 'readLists':
      return { watchlists: await listWatchlists(scope) }
    case 'readListItems':
      return watchlistData(await getWatchlist(scope, body.watchlistId))
    case 'addListing':
      return watchlistData(await addListingToWatchlist(scope, body.watchlistId, body.listing))
    case 'removeListing':
      return watchlistData(await removeListingFromWatchlist(scope, body.watchlistId, body.listing))
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return errorResponse(auth.error || 'Unauthorized', 401)
    }

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return errorResponse('Invalid request data')
    }

    const parsed = watchlistToolRequestSchema.safeParse(json)
    if (!parsed.success) {
      return errorResponse('Invalid request data')
    }

    await requireWorkspaceAccess(
      auth.userId,
      parsed.data.workspaceId,
      parsed.data.operation !== 'readLists' && parsed.data.operation !== 'readListItems'
    )

    const data = await dispatchWatchlistOperation(
      { workspaceId: parsed.data.workspaceId, userId: auth.userId },
      parsed.data
    )

    return NextResponse.json({ success: true, data }, { status: 200 })
  } catch (error) {
    if (error instanceof WatchlistOperationError) {
      return errorResponse(error.message, error.status)
    }

    logger.error(`[${requestId}] Failed to execute watchlist tool`, { error })
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to execute watchlist tool',
      500
    )
  }
}
