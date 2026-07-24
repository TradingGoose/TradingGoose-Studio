import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { applyDashboardStructureMutationInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { createSavedEntityErrorResponse } from '@/app/api/saved-entity-error-response'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; layoutId: string }> }
) {
  const userId = (await getSession(request.headers))?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: workspaceId, layoutId } = await params
  try {
    await applyDashboardStructureMutationInSocketServer({
      entityId: layoutId,
      workspaceId,
      ownerUserId: userId,
      mutation: await request.json().catch(() => null),
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const response = createSavedEntityErrorResponse(error)
    if (response) return response
    throw error
  }
}
