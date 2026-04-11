import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { parseImportedWatchlistFile } from '@/lib/watchlists/import-export'
import {
  appendWatchlistItemsToWatchlist,
  WatchlistOperationError,
} from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistImportAPI')

const WatchlistImportSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  file: z.unknown(),
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

const parseImportedWatchlistItems = (file: unknown) => {
  try {
    return parseImportedWatchlistFile(file).watchlists[0].items
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new WatchlistOperationError('Invalid watchlist import file', 400)
    }
    throw error
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
    const parsed = WatchlistImportSchema.parse(await request.json())
    await requireWorkspacePermission(userId, parsed.workspaceId)

    const items = parseImportedWatchlistItems(parsed.file)

    const result = await appendWatchlistItemsToWatchlist(
      {
        workspaceId: parsed.workspaceId,
        userId,
      },
      watchlistId,
      items
    )

    return NextResponse.json(
      {
        watchlist: result.watchlist,
        import: {
          addedCount: result.addedCount,
          skippedCount: result.skippedCount,
        },
      },
      { status: 200 }
    )
  } catch (error) {
    return handleRouteError(error, 'Failed to import watchlist')
  }
}
