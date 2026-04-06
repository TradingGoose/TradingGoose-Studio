import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  buildReviewTargetDescriptorFromEnvelope,
  buildYjsTransportEnvelope,
  parseYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import {
  bootstrapReviewTarget,
  ReviewTargetBootstrapError,
} from '@/lib/yjs/server/bootstrap-review-target'
import { getYjsSnapshot, YjsSnapshotBridgeError } from '@/lib/yjs/server/snapshot-bridge'
import { getState as getPersistedYjsState } from '@/socket-server/yjs/persistence'

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

  const access = await verifyReviewTargetAccess(userId, {
    entityKind: descriptor.entityKind,
    entityId: descriptor.entityId,
    draftSessionId: descriptor.draftSessionId,
    reviewSessionId: descriptor.reviewSessionId,
    workspaceId: descriptor.workspaceId,
    yjsSessionId: descriptor.yjsSessionId,
  })

  if (!access.hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const authorizedDescriptor = {
    ...descriptor,
    workspaceId: access.workspaceId ?? descriptor.workspaceId,
  }

  try {
    const bridgeParams = serializeYjsTransportEnvelope(
      buildYjsTransportEnvelope(authorizedDescriptor)
    )
    const snapshot = await getYjsSnapshot(sessionId, bridgeParams)
    return NextResponse.json(snapshot)
  } catch (error) {
    if (!(error instanceof YjsSnapshotBridgeError) || error.status !== 404) {
      return NextResponse.json({ error: 'Failed to load snapshot' }, { status: 500 })
    }
  }

  try {
    const resolved = await bootstrapReviewTarget(authorizedDescriptor)

    if (resolved.runtime.docState === 'expired') {
      return NextResponse.json(
        {
          snapshotBase64: '',
          ...resolved,
        },
        { status: 410 }
      )
    }

    // The bootstrap already persisted the doc, so read the state directly
    // instead of making a second HTTP round-trip via getYjsSnapshot.
    const state = await getPersistedYjsState(resolved.descriptor.yjsSessionId)
    if (!state) {
      return NextResponse.json({ error: 'Snapshot not available after bootstrap' }, { status: 500 })
    }

    return NextResponse.json({
      snapshotBase64: Buffer.from(state).toString('base64'),
      descriptor: resolved.descriptor,
      runtime: resolved.runtime,
    })
  } catch (error) {
    if (error instanceof ReviewTargetBootstrapError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to bootstrap snapshot' }, { status: 500 })
  }
}
