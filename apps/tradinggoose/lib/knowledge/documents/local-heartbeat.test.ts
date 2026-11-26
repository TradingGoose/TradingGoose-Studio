import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { armLocalDocument, disarmLocalDocument } from './local-heartbeat'

const { createWorker, connect, ports } = vi.hoisted(() => ({
  createWorker: vi.fn(),
  connect: vi.fn(),
  ports: {} as { parentPort: MessagePort },
}))
vi.mock('node:worker_threads', async (original) => ({
  ...(await original<typeof import('node:worker_threads')>()),
  Worker: createWorker,
  get parentPort() {
    return ports.parentPort
  },
}))
vi.mock('postgres', () => ({ default: connect }))

it('waits for the worker acknowledgement, renews matching live owners across leases, and drains on close', async () => {
  const { port1, port2 } = new MessageChannel()
  ports.parentPort = port2
  createWorker.mockImplementation(function () {
    void new.target
    return port1
  })
  const sql = Object.assign(
    vi.fn(async (_parts: TemplateStringsArray, _owners: unknown) => {}),
    {
      json: (owners: unknown) => owners,
      end: vi.fn(),
    }
  )
  connect.mockReturnValue(sql)
  const send = vi.spyOn(port1, 'postMessage')
  const deliver = port2.postMessage.bind(port2)
  const reply = vi.spyOn(port2, 'postMessage')
  let exited!: () => void
  const stopped = new Promise<void>((resolve) => {
    exited = resolve
  })
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    exited()
    return undefined as never
  })
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    const admitted = vi.fn((nonce: string) => nonce)
    const starting = armLocalDocument('doc').then(admitted)
    expect(createWorker).toHaveBeenCalledExactlyOnceWith(
      fileURLToPath(new URL('./local-heartbeat-worker.mjs', import.meta.url))
    )
    expect(send).not.toHaveBeenCalled()
    reply.mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
    await import('./local-heartbeat-worker.mjs')
    expect(reply).toHaveBeenCalledExactlyOnceWith('ready')
    const armed = once(port2, 'message')
    deliver('ready')
    const [request] = await armed
    expect(request).toMatchObject({ type: 'arm', id: 'doc' })
    expect(reply).toHaveBeenLastCalledWith(request.nonce)
    expect(admitted).not.toHaveBeenCalled()
    deliver(request.nonce)
    const original = { id: 'doc', nonce: await starting }

    const replacement = { id: 'doc', nonce: await armLocalDocument('doc') }
    const locked = { id: 'locked', nonce: await armLocalDocument('locked') }
    const expired = { id: 'expired', nonce: await armLocalDocument('expired') }
    expect(replacement.nonce).not.toBe(original.nonce)
    expect(createWorker).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(sql).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sql).toHaveBeenCalledTimes(1)
    const [parts, owners] = sql.mock.calls[0]
    expect(owners).toEqual([original, replacement, locked, expired])
    // PostgreSQL applies these filters. Inspect the worker's actual statement at the driver boundary.
    expect(parts.join('$1').replace(/\s+/g, ' ').trim()).toBe(
      [
        'with live as ( select p.id from pending_execution p',
        'join jsonb_to_recordset($1::jsonb) as a(id text, nonce text)',
        "on a.id = p.id and p.payload->>'localDocumentNonce' = a.nonce",
        "where p.billing_scope_type = 'local' and p.execution_type = 'document'",
        "and p.source = 'document_processing' and p.status = 'processing'",
        "and p.updated_at > (clock_timestamp() at time zone 'UTC') - interval '90 seconds'",
        'for update of p skip locked )',
        "update pending_execution p set updated_at = clock_timestamp() at time zone 'UTC'",
        'from live where p.id = live.id',
      ].join(' ')
    )

    send.mockClear()
    disarmLocalDocument('wrong document', replacement.nonce)
    expect(send).not.toHaveBeenCalled()
    const disarmed = once(port2, 'message')
    disarmLocalDocument(original.id, original.nonce)
    expect((await disarmed)[0]).toEqual({ type: 'disarm', nonce: original.nonce })
    await vi.advanceTimersByTimeAsync(90_000)
    expect(sql).toHaveBeenCalledTimes(4)
    expect(sql.mock.calls.slice(1).map(([, bound]) => bound)).toEqual(
      Array(3).fill([replacement, locked, expired])
    )

    let finishRenewal!: () => void
    sql.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRenewal = resolve
        })
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sql).toHaveBeenCalledTimes(5)
    const closing = new Promise<void>((resolve) =>
      port2.on('message', (message) => {
        if (message.type === 'close') resolve()
      })
    )
    for (const owner of [replacement, locked, expired]) disarmLocalDocument(owner.id, owner.nonce)
    await closing
    expect(sql.end).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    finishRenewal()
    await stopped
    expect(sql.end).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sql).toHaveBeenCalledTimes(5)
  } finally {
    port1.emit('exit', 0)
    port1.close()
    port2.close()
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})
