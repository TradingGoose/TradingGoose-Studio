import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  addListingToWatchlist,
  addSectionToWatchlist,
  renameWatchlistSection,
  removeWatchlistItem,
  removeWatchlistSection,
  updateWatchlistItemListing,
  WatchlistOperationError,
} from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistItemsAPI')

const WatchlistItemsSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  action: z.enum([
    'addListing',
    'updateListing',
    'addSection',
    'renameSection',
    'removeItem',
    'removeSection',
  ]),
  listing: z
    .object({
      listing_id: z.string(),
      base_id: z.string(),
      quote_id: z.string(),
      listing_type: z.enum(['default', 'crypto', 'currency']),
    })
    .passthrough()
    .optional(),
  label: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  sectionId: z.string().trim().min(1).optional(),
})

const requireSessionUser = async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    throw new WatchlistOperationError('Unauthorized', 401)
  }
  return session.user.id
}

const requireWorkspacePermission = async (userId: string, workspaceId: string) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    throw new WatchlistOperationError('Access denied', 403)
  }
  if (permission === 'read') {
    throw new WatchlistOperationError('Write permission required', 403)
  }
}

const handleRouteError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Invalid request data', details: error.errors },
      { status: 400 }
    )
  }
  logger.error(fallbackMessage, { error })
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ watchlistId: string }> }
) {
  try {
    const userId = await requireSessionUser()
    const { watchlistId } = await params
    const parsed = WatchlistItemsSchema.parse(await request.json())
    await requireWorkspacePermission(userId, parsed.workspaceId)

    const scope = {
      workspaceId: parsed.workspaceId,
      userId,
    }

    if (parsed.action === 'addListing') {
      if (!parsed.listing) {
        return NextResponse.json({ error: 'listing is required' }, { status: 400 })
      }
      const watchlist = await addListingToWatchlist(scope, watchlistId, parsed.listing)
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (parsed.action === 'addSection') {
      if (!parsed.label) {
        return NextResponse.json({ error: 'label is required' }, { status: 400 })
      }
      const watchlist = await addSectionToWatchlist(scope, watchlistId, parsed.label)
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (parsed.action === 'updateListing') {
      if (!parsed.itemId) {
        return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
      }
      if (!parsed.listing) {
        return NextResponse.json({ error: 'listing is required' }, { status: 400 })
      }
      const watchlist = await updateWatchlistItemListing(
        scope,
        watchlistId,
        parsed.itemId,
        parsed.listing
      )
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (parsed.action === 'renameSection') {
      if (!parsed.sectionId) {
        return NextResponse.json({ error: 'sectionId is required' }, { status: 400 })
      }
      if (!parsed.label) {
        return NextResponse.json({ error: 'label is required' }, { status: 400 })
      }
      const watchlist = await renameWatchlistSection(scope, watchlistId, parsed.sectionId, parsed.label)
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (parsed.action === 'removeSection') {
      if (!parsed.sectionId) {
        return NextResponse.json({ error: 'sectionId is required' }, { status: 400 })
      }
      const watchlist = await removeWatchlistSection(scope, watchlistId, parsed.sectionId)
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (!parsed.itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
    }
    const watchlist = await removeWatchlistItem(scope, watchlistId, parsed.itemId)
    return NextResponse.json({ watchlist }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to update watchlist items')
  }
}
