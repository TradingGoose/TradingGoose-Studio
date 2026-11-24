import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

type Registration = { id: string; ready: () => void; reject: (error: Error) => void }

function startHeartbeat() {
  const worker = new Worker(
    path.join(process.cwd(), 'lib/knowledge/documents/local-heartbeat-worker.mjs')
  )
  const registrations = new Map<string, Registration>()
  const owner = { worker, registrations, listening: false }
  worker.on('message', (nonce: string) => {
    if (nonce !== 'ready') return registrations.get(nonce)?.ready()
    owner.listening = true
    for (const [nonce, { id }] of registrations) worker.postMessage({ type: 'arm', id, nonce })
  })
  const failed = (error: Error) => {
    for (const registration of registrations.values()) registration.reject(error)
    registrations.clear()
    if (processRuntime.__studioDocumentHeartbeat?.worker === worker)
      processRuntime.__studioDocumentHeartbeat = undefined
  }
  worker.on('error', failed)
  worker.on('exit', () => failed(new Error('Document renewal worker exited')))
  return owner
}

const processRuntime = globalThis as typeof globalThis & {
  __studioDocumentHeartbeat?: ReturnType<typeof startHeartbeat>
}

export async function armLocalDocument(id: string) {
  const owner = (processRuntime.__studioDocumentHeartbeat ??= startHeartbeat())
  const nonce = randomUUID()
  await new Promise<void>((resolve, reject) => {
    owner.registrations.set(nonce, { id, ready: resolve, reject })
    if (owner.listening) owner.worker.postMessage({ type: 'arm', id, nonce })
  })
  return nonce
}

export function disarmLocalDocument(id: string, nonce: string) {
  const active = processRuntime.__studioDocumentHeartbeat
  if (!active || active.registrations.get(nonce)?.id !== id) return
  active.registrations.delete(nonce)
  active.worker.postMessage({ type: 'disarm', nonce })
  if (!active.registrations.size) {
    active.worker.postMessage({ type: 'close' })
    processRuntime.__studioDocumentHeartbeat = undefined
  }
}
