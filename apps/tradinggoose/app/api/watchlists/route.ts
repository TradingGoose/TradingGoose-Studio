import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import {
  createWatchlist,
  listWatchlists,
  WatchlistOperationError,
} from '@/lib/watchlists/operations'

const logger = createLogger('WatchlistsAPI')

const CreateWatchlistSchema = z.object({
  workspaceId: z.string().trim().min(1, 'workspaceId is required'),
  name: z.string().trim().min(1, 'name is required'),
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

export async function GET(request: NextRequest) {
  try {
    const userId = await requireSessionUser()
    const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    await requireWorkspacePermission(userId, workspaceId)

    const watchlists = await listWatchlists({
      workspaceId,
      userId,
    })

    return NextResponse.json({ watchlists }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch watchlists')
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireSessionUser()
    const parsed = CreateWatchlistSchema.parse(await request.json())
    await requireWorkspacePermission(userId, parsed.workspaceId, { write: true })

    const watchlist = await createWatchlist(
      {
        workspaceId: parsed.workspaceId,
        userId,
      },
      parsed.name
    )

    return NextResponse.json({ watchlist }, { status: 200 })
  } catch (error) {
    return handleRouteError(error, 'Failed to create watchlist')
  }
}
