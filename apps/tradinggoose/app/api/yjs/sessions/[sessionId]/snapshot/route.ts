import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  buildReviewTargetDescriptorFromEnvelope,
  parseYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import { mcpService } from '@/lib/mcp/service'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import {
  persistSavedEntityYjsState,
  SavedEntityPersistenceError,
} from '@/lib/yjs/server/apply-entity-state'
import {
  ReviewTargetBootstrapError,
  readBootstrappedReviewTargetSnapshot,
} from '@/lib/yjs/server/bootstrap-review-target'
import { applyYjsUpdateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'

export const dynamic = 'force-dynamic'

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

  const access = await verifyReviewTargetAccess(
    session.user.id,
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
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return {
    descriptor: {
      ...descriptor,
      workspaceId: access.workspaceId ?? descriptor.workspaceId,
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
    if (error instanceof ReviewTargetBootstrapError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
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
  if (descriptor.entityKind === 'workflow' || !descriptor.entityId || !descriptor.workspaceId) {
    return NextResponse.json({ error: 'Saved entity Yjs session required' }, { status: 400 })
  }
  const entityKind: SavedEntityKind = descriptor.entityKind

  try {
    const { updateBase64 } = (await request.json().catch(() => ({}))) as {
      updateBase64?: unknown
    }
    if (typeof updateBase64 !== 'string' || !updateBase64) {
      return NextResponse.json({ error: 'updateBase64 is required' }, { status: 400 })
    }

    await applyYjsUpdateInSocketServer(
      descriptor.yjsSessionId,
      request.nextUrl.search,
      updateBase64
    )
    await persistSavedEntityYjsState(entityKind, descriptor.entityId, descriptor.workspaceId)

    if (descriptor.entityKind === 'mcp_server') {
      mcpService.clearCache(descriptor.workspaceId)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (
      error instanceof SavedEntityPersistenceError ||
      error instanceof ReviewTargetBootstrapError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to save Yjs session' }, { status: 500 })
  }
}
