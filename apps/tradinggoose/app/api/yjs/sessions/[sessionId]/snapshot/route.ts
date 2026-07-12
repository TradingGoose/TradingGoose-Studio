import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  buildReviewTargetDescriptorFromEnvelope,
  buildYjsTransportEnvelope,
  parseYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import { readBootstrappedReviewTargetSnapshot } from '@/lib/yjs/server/bootstrap-review-target'
import {
  applyYjsUpdateInSocketServer,
  SocketServerBridgeError,
} from '@/lib/yjs/server/snapshot-bridge'

export const dynamic = 'force-dynamic'

function getPublicBridgeStatus(error: SocketServerBridgeError) {
  const { status } = error
  return status === 400 || status === 404 || status === 409 || status === 410 ? status : 503
}

async function authorizeYjsSnapshotRequest(
  request: NextRequest,
  sessionId: string,
  accessMode: 'read' | 'write'
) {
  const session = await getSession()
  if (!session?.user?.id) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  let descriptor
  try {
    const envelope = parseYjsTransportEnvelope(Object.fromEntries(request.nextUrl.searchParams))
    descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
  } catch (error) {
    return {
      response: NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid transport envelope' },
        { status: 400 }
      ),
    }
  }

  if (descriptor.yjsSessionId !== sessionId) {
    return { response: NextResponse.json({ error: 'Session ID mismatch' }, { status: 409 }) }
  }

  const access = await verifyReviewTargetAccess(session.user.id, descriptor, accessMode).catch(
    () => null
  )

  if (!access) {
    return { response: NextResponse.json({ error: 'Authorization unavailable' }, { status: 503 }) }
  }

  if (!access.hasAccess) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return {
    descriptor: {
      ...descriptor,
      workspaceId: access.workspaceId,
      ownerUserId:
        descriptor.entityKind === 'dashboard_layout' ||
        descriptor.entityKind === 'dashboard_widget' ||
        descriptor.entityKind === 'dashboard_color_pair'
          ? session.user.id
          : null,
    },
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const accessMode = request.nextUrl.searchParams.get('accessMode')
  if (accessMode !== 'read' && accessMode !== 'write') {
    return NextResponse.json({ error: 'Invalid access mode' }, { status: 400 })
  }

  const authorized = await authorizeYjsSnapshotRequest(request, sessionId, accessMode)
  if ('response' in authorized) return authorized.response

  try {
    const snapshot = await readBootstrappedReviewTargetSnapshot(authorized.descriptor)
    return NextResponse.json(snapshot, {
      status: snapshot.runtime.docState === 'expired' ? 410 : 200,
    })
  } catch (error) {
    if (error instanceof SocketServerBridgeError) {
      return NextResponse.json({ error: error.message }, { status: getPublicBridgeStatus(error) })
    }

    return NextResponse.json({ error: 'Failed to load snapshot' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const authorized = await authorizeYjsSnapshotRequest(request, sessionId, 'write')
  if ('response' in authorized) return authorized.response

  const { descriptor } = authorized
  if (
    descriptor.entityKind === 'workflow' ||
    descriptor.entityKind === 'dashboard_layout' ||
    !descriptor.entityId ||
    !descriptor.workspaceId
  ) {
    return NextResponse.json({ error: 'Saved entity Yjs session required' }, { status: 400 })
  }

  try {
    const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const { updateBase64, identity } = rawBody
    if (typeof updateBase64 !== 'string' || !updateBase64) {
      return NextResponse.json({ error: 'updateBase64 is required' }, { status: 400 })
    }

    const params = new URLSearchParams({
      ...serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor)),
      accessMode: 'write',
    })
    await applyYjsUpdateInSocketServer(
      descriptor.yjsSessionId,
      `?${params.toString()}`,
      updateBase64,
      identity
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof SocketServerBridgeError) {
      return NextResponse.json({ error: error.message }, { status: getPublicBridgeStatus(error) })
    }

    return NextResponse.json({ error: 'Failed to save Yjs session' }, { status: 500 })
  }
}
