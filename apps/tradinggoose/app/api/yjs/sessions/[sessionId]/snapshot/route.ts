import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  buildReviewTargetDescriptorFromEnvelope,
  parseYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import {
  readBootstrappedReviewTargetSnapshot,
  ReviewTargetBootstrapError,
} from '@/lib/yjs/server/bootstrap-review-target'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const { sessionId } = await params

  const queryParams: Record<string, string | undefined> = {}
  request.nextUrl.searchParams.forEach((value, key) => {
    queryParams[key] = value
  })
  const accessMode = request.nextUrl.searchParams.get('accessMode')
  if (accessMode !== 'read' && accessMode !== 'write') {
    return NextResponse.json({ error: 'Invalid access mode' }, { status: 400 })
  }

  let descriptor
  try {
    const envelope = parseYjsTransportEnvelope(queryParams)
    descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid transport envelope' },
      { status: 400 }
    )
  }

  if (descriptor.yjsSessionId !== sessionId) {
    return NextResponse.json({ error: 'Session ID mismatch' }, { status: 409 })
  }

  const access = await verifyReviewTargetAccess(
    userId,
    {
      entityKind: descriptor.entityKind,
      entityId: descriptor.entityId,
      draftSessionId: descriptor.draftSessionId,
      reviewSessionId: descriptor.reviewSessionId,
      workspaceId: descriptor.workspaceId,
      yjsSessionId: descriptor.yjsSessionId,
    },
    accessMode
  )

  if (!access.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const authorizedDescriptor = {
    ...descriptor,
    workspaceId: access.workspaceId ?? descriptor.workspaceId,
  }

  try {
    const snapshot = await readBootstrappedReviewTargetSnapshot(authorizedDescriptor)
    return NextResponse.json(snapshot, {
      status: snapshot.runtime.docState === 'expired' ? 410 : 200,
    })
  } catch (error) {
    if (error instanceof ReviewTargetBootstrapError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to load snapshot' }, { status: 500 })
  }
}
