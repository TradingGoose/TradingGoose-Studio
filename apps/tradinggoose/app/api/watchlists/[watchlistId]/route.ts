import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  clearWatchlist,
  deleteWatchlist,
  renameWatchlist,
  reorderWatchlistItems,
  updateWatchlistSettings,
  WatchlistOperationError,
} from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistByIdAPI')

const PatchWatchlistSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  action: z.enum(['rename', 'clear', 'settings', 'reorder']),
  name: z.string().trim().min(1).optional(),
  settings: z
    .object({
      showLogo: z.boolean().optional(),
      showTicker: z.boolean().optional(),
      showDescription: z.boolean().optional(),
    })
    .optional(),
  orderedItemIds: z.array(z.string().trim().min(1)).optional(),
})

const requireSessionUser = async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    throw new WatchlistOperationError('Unauthorized', 401)
  }
  return session.user.id
}

const requireWorkspacePermission = async (
  userId: string,
  workspaceId: string,
  options?: { write?: boolean }
) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    throw new WatchlistOperationError('Access denied', 403)
  }
  if (options?.write && permission === 'read') {
    throw new WatchlistOperationError('Write permission required', 403)
  }
}

const handleRouteError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 })
  }
  logger.error(fallbackMessage, { error })
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ watchlistId: string }> }
) {
  try {
    const userId = await requireSessionUser()
    const { watchlistId } = await params
    const parsed = PatchWatchlistSchema.parse(await request.json())
    await requireWorkspacePermission(userId, parsed.workspaceId, { write: true })

    const scope = {
      workspaceId: parsed.workspaceId,
      userId,
    }

    if (parsed.action === 'rename') {
      if (!parsed.name) {
        return NextResponse.json({ error: 'name is required for rename' }, { status: 400 })
      }
      const watchlist = await renameWatchlist(scope, watchlistId, parsed.name)
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (parsed.action === 'clear') {
      const watchlist = await clearWatchlist(scope, watchlistId)
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (parsed.action === 'settings') {
      const watchlist = await updateWatchlistSettings(scope, watchlistId, parsed.settings ?? {})
      return NextResponse.json({ watchlist }, { status: 200 })
    }

    if (!parsed.orderedItemIds || parsed.orderedItemIds.length === 0) {
      return NextResponse.json({ error: 'orderedItemIds is required for reorder' }, { status: 400 })
    }
    const watchlist = await reorderWatchlistItems(scope, watchlistId, parsed.orderedItemIds)
    return NextResponse.json({ watchlist }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to update watchlist')
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ watchlistId: string }> }
) {
  try {
    const userId = await requireSessionUser()
    const { watchlistId } = await params
    const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    await requireWorkspacePermission(userId, workspaceId, { write: true })

    await deleteWatchlist(
      {
        workspaceId,
        userId,
      },
      watchlistId
    )

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to delete watchlist')
  }
}
