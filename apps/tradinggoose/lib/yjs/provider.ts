import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import type {
  ReviewAccessMode,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { getEnv } from '@/lib/env'
import { applySnapshotToDoc } from './client'

export interface YjsProviderBootstrapResult {
  doc: Y.Doc
  provider: WebsocketProvider
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
  accessMode: ReviewAccessMode
}

const SYNC_TIMEOUT_MS = 10_000

async function fetchSocketToken(): Promise<string> {
  const res = await fetch('/api/auth/socket-token', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { 'cache-control': 'no-store' },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch socket token: ${res.status}`)
  }

  const data = await res.json()
  return data.token
}

async function fetchSnapshot(
  sessionId: string,
  envelopeParams: Record<string, string>,
  accessMode: ReviewAccessMode
): Promise<{
  snapshotBase64: string
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
}> {
  const params = new URLSearchParams({
    ...envelopeParams,
    accessMode,
  })
  const res = await fetch(`/api/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot?${params}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Snapshot fetch failed: ${res.status}`)
  }

  return res.json()
}

export function waitForYjsSync(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null

    const finish = (error?: Error) => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      provider.off('sync', handleSync)
      error ? reject(error) : resolve()
    }

    const handleSync = (isSynced: boolean) => {
      if (isSynced) {
        finish()
      }
    }

    const handleSyncTimeout = () => {
      finish(new Error('Failed to establish authorized Yjs sync'))
    }

    timeout = setTimeout(handleSyncTimeout, SYNC_TIMEOUT_MS)
    provider.on('sync', handleSync)

    if (provider.synced) {
      finish()
    }
  })
}

export async function bootstrapYjsProvider(
  descriptor: ReviewTargetDescriptor,
  wsOrigin = getDefaultWsOrigin(),
  accessMode: ReviewAccessMode = 'write'
): Promise<YjsProviderBootstrapResult> {
  const doc = new Y.Doc()

  const initialEnvelope = buildYjsTransportEnvelope(descriptor)
  const initialEnvelopeParams = serializeYjsTransportEnvelope(initialEnvelope)
  const snapshot = await fetchSnapshot(descriptor.yjsSessionId, initialEnvelopeParams, accessMode)
  const resolvedDescriptor = snapshot.descriptor
  const runtime = snapshot.runtime

  if (snapshot.snapshotBase64) {
    applySnapshotToDoc(doc, snapshot.snapshotBase64)
  }

  const serverUrl = `${wsOrigin}/yjs`

  const envelopeParams = serializeYjsTransportEnvelope(
    buildYjsTransportEnvelope(resolvedDescriptor)
  )
  const token = await fetchSocketToken()

  const provider = new WebsocketProvider(serverUrl, resolvedDescriptor.yjsSessionId, doc, {
    params: { token, accessMode, ...envelopeParams },
    connect: true,
    disableBc: true,
  })
  const handleConnectionLoss = () => {
    provider.shouldConnect = false
  }
  provider.on('connection-close', handleConnectionLoss)
  provider.on('connection-error', handleConnectionLoss)

  if (accessMode === 'write') {
    try {
      await waitForYjsSync(provider)
    } catch (error) {
      provider.disconnect()
      provider.destroy()
      doc.destroy()
      throw error
    }
  }

  return {
    doc,
    provider,
    descriptor: resolvedDescriptor,
    runtime,
    accessMode,
  }
}

function getDefaultWsOrigin(): string {
  return (getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
}
