import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { createWatchlist, WatchlistOperationError } from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistsAPI')
const CreateWatchlistSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  name: z.string().trim().min(1, 'Watchlist name is required'),
})

const requireSessionUser = async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    throw new WatchlistOperationError(auth.error || 'Unauthorized', 401)
  }
  return auth.userId
}

const requireWorkspacePermission = async (
  userId: string,
  workspaceId: string,
  options: { write?: boolean } = {}
) => {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) {
    throw new WatchlistOperationError('Access denied', 403)
  }
  if (options.write && permission !== 'admin' && permission !== 'write') {
    throw new WatchlistOperationError('Write permission required', 403)
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
  logger.error(errorMessage, { error })
  return NextResponse.json({ error: errorMessage }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireSessionUser(request)
    const parsed = CreateWatchlistSchema.parse(await request.json())
    await requireWorkspacePermission(userId, parsed.workspaceId, { write: true })

    const watchlist = await createWatchlist(
      { workspaceId: parsed.workspaceId },
      { name: parsed.name }
    )

    return NextResponse.json({ watchlist }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to create watchlist')
  }
}
