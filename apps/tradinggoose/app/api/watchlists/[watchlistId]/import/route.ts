import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { parseImportedWatchlistFile } from '@/lib/watchlists/import-export'
import { getWatchlist, WatchlistOperationError } from '@/lib/watchlists/operations'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import { applyEntityStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { createSavedEntityErrorResponse } from '@/app/api/saved-entity-error-response'

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

const parseImportedWatchlistDocument = (file: unknown) => {
  try {
    return parseImportedWatchlistFile(file)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new WatchlistOperationError('Invalid watchlist import file', 400)
    }
    if (error instanceof WatchlistDocumentError) {
      throw new WatchlistOperationError(error.message, error.status)
    }
    throw error
  }
}

const handleRouteError = (error: unknown, errorMessage: string) => {
  if (error instanceof WatchlistOperationError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Invalid request data', details: error.errors },
      { status: 400 }
    )
  }
  const realtimeResponse = createSavedEntityErrorResponse(error)
  if (realtimeResponse) return realtimeResponse
  logger.error(errorMessage, { error })
  return NextResponse.json({ error: errorMessage }, { status: 500 })
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

    const fields = parseImportedWatchlistDocument(parsed.file)

    await getWatchlist({ workspaceId: parsed.workspaceId }, watchlistId)
    const { name, ...content } = fields
    await applyEntityStateInSocketServer(
      watchlistId,
      'watchlist',
      parsed.workspaceId,
      userId,
      content,
      { identity: { name } }
    )
    const watchlist = await getWatchlist({ workspaceId: parsed.workspaceId }, watchlistId)

    return NextResponse.json({ watchlist }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to import watchlist')
  }
}
