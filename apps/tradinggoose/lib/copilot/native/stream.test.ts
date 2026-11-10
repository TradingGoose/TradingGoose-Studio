import { describe, expect, it, vi } from 'vitest'
import {
  COPILOT_NATIVE_REVISION,
  type CompletionEvent,
  type CopilotEvent,
  type CopilotRequest,
  type Pending,
} from './contract'
import { readNativeEvents, relayNativeEvents } from './stream'

const requestId = 'stream-request'
const financial = {
  accepted: true,
  modelUsd: 'unavailable',
  appliedUsd: '0.30000000000000001',
} as const
const finished: CopilotEvent = {
  type: 'response.completed',
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId,
  result: {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    status: 'completed',
    runId: 'run',
    threadId: 'thread',
    text: 'hello',
    financial,
  },
}
const completion: CompletionEvent = {
  done: true,
  result: {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    status: 'completed',
    runId: 'utility-run',
    text: 'done',
    financial,
  },
}
const encoder = new TextEncoder()
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
function source(chunks: Uint8Array[], cancel = vi.fn()) {
  let index = 0
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++])
    else controller.close()
  })
  return {
    stream: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
    pull,
    cancel,
  }
}
async function collect<T>(events: AsyncIterable<T>) {
  const result: T[] = []
  for await (const event of events) result.push(event)
  return result
}

describe('closed native product event decoding', () => {
  it('preserves split UTF8, frame boundaries and CRLF without exposing raw envelopes', async () => {
    const event: CopilotEvent = {
      type: 'text.delta',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      text: ' exact🦆\n',
    }
    const bytes = encoder.encode((frame(event) + frame(finished)).replaceAll('\n\n', '\r\n\r\n'))
    const { stream } = source(Array.from(bytes, (byte) => Uint8Array.of(byte)))
    expect(await collect(readNativeEvents(stream, 'CopilotEvent', { requestId }))).toEqual([
      event,
      finished,
    ])
  })
  it('handles valid multiline data and comments', async () => {
    const { stream } = source([
      encoder.encode(`: heartbeat\n\ndata: {"chunk":\ndata: "preview"}\n\n${frame(completion)}`),
    ])
    expect(await collect(readNativeEvents(stream, 'CompletionEvent', { requestId }))).toEqual([
      { chunk: 'preview' },
      completion,
    ])
  })
  it.each([
    {
      type: 'text.delta',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      text: 'safe',
      headers: { authorization: 'private' },
    },
    { type: 'step-finish', requestId, history: ['private'] },
    { choices: [{ delta: { content: 'raw' } }] },
    {
      type: 'tool.display',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      toolCallId: 'call',
      toolName: 'read_workflow',
      executionAuthorized: true,
    },
  ])('refuses raw/extended/actionable display envelopes: %j', async (value) => {
    await expect(
      collect(
        readNativeEvents(source([encoder.encode(frame(value))]).stream, 'CopilotEvent', {
          requestId,
        })
      )
    ).rejects.toThrow('Invalid native')
  })
  it('checks nested terminal correlation as well as the outer event', async () => {
    await expect(
      collect(
        readNativeEvents(
          source([
            encoder.encode(
              frame({ ...finished, result: { ...finished.result, requestId: 'stale' } })
            ),
          ]).stream,
          'CopilotEvent',
          { requestId }
        )
      )
    ).rejects.toThrow('does not match')
    await expect(
      collect(
        readNativeEvents(
          source([
            encoder.encode(
              frame({ ...completion, result: { ...completion.result, requestId: 'stale' } })
            ),
          ]).stream,
          'CompletionEvent',
          { requestId }
        )
      )
    ).rejects.toThrow('does not match')
  })
  it('refuses a truncated final frame and retired DONE sentinel', async () => {
    for (const value of ['data: {"chunk":"unfinished"}', 'data: [DONE]\n\n']) {
      await expect(
        collect(
          readNativeEvents(source([encoder.encode(value)]).stream, 'CompletionEvent', { requestId })
        )
      ).rejects.toThrow()
    }
  })
  it('retains an explicit accepted failure without producing a successful done frame', async () => {
    const event = {
      error: 'Delivery failed',
      code: 'NATIVE_FAILURE',
      refusal: false,
      uncertain: false,
      financialDisposition: 'accepted',
      financial,
    }
    expect(
      await collect(
        readNativeEvents(source([encoder.encode(frame(event))]).stream, 'CompletionEvent', {
          requestId,
        })
      )
    ).toEqual([event])
  })
  it.each([undefined, 0, '0.0', '+0', '1e-2', '-0', 'not-money'])(
    'refuses invalid accepted money %j at the actual event decoder',
    async (appliedUsd) => {
      const value = {
        ...finished,
        result: { ...finished.result, financial: { ...financial, appliedUsd } },
      }
      await expect(
        collect(
          readNativeEvents(source([encoder.encode(frame(value))]).stream, 'CopilotEvent', {
            requestId,
          })
        )
      ).rejects.toThrow('Invalid native')
    }
  )
  it.each(['0', '0.30000000000000001', '9007199254740993.1234567890123456789'])(
    'retains exact accepted amount %s without changing unavailable model USD',
    async (appliedUsd) => {
      const value = {
        ...finished,
        result: { ...finished.result, financial: { ...financial, appliedUsd } },
      }
      expect(
        await collect(
          readNativeEvents(source([encoder.encode(frame(value))]).stream, 'CopilotEvent', {
            requestId,
          })
        )
      ).toEqual([value])
    }
  )
  it('preserves the selected correlated cancellation event as an acknowledgement', async () => {
    const cancelled: CopilotEvent = {
      type: 'response.cancel_requested',
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      result: {
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        status: 'cancel_requested',
        runId: 'run',
        acknowledged: true,
        uncertaintyRemains: true,
      },
    }
    expect(
      await collect(
        readNativeEvents(source([encoder.encode(frame(cancelled))]).stream, 'CopilotEvent', {
          requestId,
        })
      )
    ).toEqual([cancelled])
  })
})

describe('reader-driven native relay', () => {
  it.each([true, false])(
    'treats deterministic pruning applied=%s as an unbilled terminal',
    async (applied) => {
      const event: CopilotEvent = {
        type: 'context.compacted',
        protocolRevision: COPILOT_NATIVE_REVISION,
        requestId,
        result: {
          protocolRevision: COPILOT_NATIVE_REVISION,
          requestId,
          status: 'compacted',
          threadId: 'thread',
          applied,
          sourceBoundaryVerified: true,
        },
      }
      const abortUpstream = vi.fn()
      const relay = (events: unknown[]) =>
        relayNativeEvents(
          source([encoder.encode(events.map(frame).join(''))]).stream,
          'CopilotEvent',
          {
            requestId,
            command: 'context.compact',
            abortUpstream,
          }
        )
      expect(await new Response(relay([event])).text()).toBe(frame(event))
      expect(abortUpstream).not.toHaveBeenCalled()
      await expect(new Response(relay([event, finished])).text()).rejects.toThrow(
        'after its terminal'
      )
      expect(abortUpstream).toHaveBeenCalledOnce()
      for (const result of [
        { ...event.result, requestId: 'other' },
        { ...event.result, protocolRevision: 'unselected' },
        { ...event.result, financial },
        { ...event.result, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        { ...event.result, runId: 'borrowed-model-run' },
      ]) {
        await expect(new Response(relay([{ ...event, result }])).text()).rejects.toThrow()
      }
    }
  )
  it('cancels an untouched source without eagerly acquiring or reading it', async () => {
    const upstream = source([encoder.encode(frame(completion))])
    const abortUpstream = vi.fn()
    const relay = relayNativeEvents(upstream.stream, 'CompletionEvent', {
      requestId,
      abortUpstream,
    })
    await relay.cancel()
    expect(upstream.pull).not.toHaveBeenCalled()
    expect(upstream.cancel).toHaveBeenCalledOnce()
    expect(abortUpstream).toHaveBeenCalledOnce()
  })
  it('reads no source data before demand and forwards one validated frame per pull', async () => {
    const upstream = source([
      encoder.encode(frame({ chunk: 'first' })),
      encoder.encode(frame(completion)),
    ])
    const abortUpstream = vi.fn()
    const relay = relayNativeEvents(upstream.stream, 'CompletionEvent', {
      requestId,
      abortUpstream,
    })
    await Promise.resolve()
    expect(upstream.pull).not.toHaveBeenCalled()
    const reader = relay.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame({ chunk: 'first' }))
    expect(upstream.pull).toHaveBeenCalledOnce()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame(completion))
    expect(upstream.pull).toHaveBeenCalledTimes(2)
    expect((await reader.read()).done).toBe(true)
    expect(abortUpstream).not.toHaveBeenCalled()
    reader.releaseLock()
  })
  it('refuses EOF without an explicit outcome and data after a terminal result', async () => {
    for (const data of [
      frame({ chunk: 'partial' }),
      frame(completion) + frame({ chunk: 'late' }),
    ]) {
      const abortUpstream = vi.fn()
      const relay = relayNativeEvents(source([encoder.encode(data)]).stream, 'CompletionEvent', {
        requestId,
        abortUpstream,
      })
      await expect(new Response(relay).text()).rejects.toThrow()
      expect(abortUpstream).toHaveBeenCalled()
    }
  })
  it('actively releases a pending upstream read on downstream cancellation', async () => {
    const cancel = vi.fn()
    const upstream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
    const abortUpstream = vi.fn()
    const reader = relayNativeEvents(upstream, 'CompletionEvent', {
      requestId,
      abortUpstream,
    }).getReader()
    const waiting = reader.read()
    await Promise.resolve()
    await reader.cancel()
    expect((await waiting).done).toBe(true)
    expect(abortUpstream).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    reader.releaseLock()
  })
})

const invocationCommands = ['message', 'tool.approve', 'tool.decline', 'tool.result'] as const
function compacted(applied: boolean): CopilotEvent {
  return {
    type: 'context.compacted',
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    result: {
      protocolRevision: COPILOT_NATIVE_REVISION,
      requestId,
      status: 'compacted',
      threadId: 'thread',
      applied,
      sourceBoundaryVerified: true,
    },
  }
}
const cancelled: CopilotEvent = {
  type: 'response.cancel_requested',
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId,
  result: {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    status: 'cancel_requested',
    runId: 'run',
    acknowledged: true,
    uncertaintyRemains: true,
  },
}
const originalPending: Pending = {
  target: {
    threadId: 'thread',
    resourceId: 'resource',
    runId: 'run',
    toolCallId: 'call',
    toolName: 'search_online',
  },
  stage: 'approval',
  originalArgs: { query: 'test' },
  financialBinding: {
    namespace: 'billing',
    key: 'key',
    fingerprint: 'fingerprint',
    runId: 'run',
    actorUserId: 'actor',
    workspaceId: null,
    workflowId: null,
    purpose: 'copilot',
  },
  financialOccurrence: { stepNumber: 0, retryCount: 0, runId: 'run' },
}
const suspended: CopilotEvent = {
  type: 'response.suspended',
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId,
  result: { ...finished.result, status: 'suspended', pending: [originalPending] },
}
const refused: CopilotEvent = {
  type: 'response.refused',
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId,
  result: {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    status: 'refused',
    error: { code: 'FORBIDDEN', message: 'Refused', retryable: false, uncertain: false },
  },
}
const failed: CopilotEvent = {
  type: 'response.error',
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId,
  result: {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    status: 'failed',
    error: {
      code: 'NATIVE_FAILURE',
      message: 'Failed after response',
      retryable: false,
      uncertain: false,
    },
    financial,
    usage: { inputTokens: 0, totalTokens: 7 },
  },
}
const validCommandTerminals = invocationCommands.flatMap((command) =>
  [finished, suspended, refused, failed].map((event) => ({ command, event }))
)

async function projectedRelay(events: CopilotEvent[], command: CopilotRequest['command']) {
  const upstream = source([encoder.encode(events.map(frame).join(''))])
  const abortUpstream = vi.fn()
  const stream = relayNativeEvents(upstream.stream, 'CopilotEvent', {
    requestId,
    command,
    abortUpstream,
  })
  return {
    events: await collect(readNativeEvents(stream, 'CopilotEvent', { requestId })),
    upstream,
    abortUpstream,
  }
}

describe('actual command-bound Copilot terminal relay', () => {
  it.each(validCommandTerminals)(
    'preserves the canonical command/result pair: %j',
    async ({ command, event }) => {
      const result = await projectedRelay([event], command)
      expect(result.events).toEqual([event])
      expect(result.abortUpstream).not.toHaveBeenCalled()
    }
  )
  it.each([refused, failed])('preserves a canonical compaction error: %j', async (event) => {
    const result = await projectedRelay([event], 'context.compact')
    expect(result.events).toEqual([event])
    expect(result.abortUpstream).not.toHaveBeenCalled()
  })
  it.each(
    invocationCommands.flatMap((command) =>
      [compacted(true), compacted(false), cancelled].map((event) => ({ command, event }))
    )
  )(
    'refuses a valid-schema wrong-command terminal before forwarding: %j',
    async ({ command, event }) => {
      const result = await projectedRelay([event], command)
      expect(result.events).toMatchObject([
        {
          type: 'response.error',
          result: {
            status: 'failed',
            error: { code: 'UNCERTAIN', retryable: false, uncertain: true },
          },
        },
      ])
      expect(result.events).toHaveLength(1)
      expect(result.events[0]).not.toHaveProperty('result.financial')
      expect(result.events[0]).not.toHaveProperty('result.usage')
      expect(result.events[0]).not.toHaveProperty('result.applied')
      expect(result.abortUpstream).toHaveBeenCalledOnce()
      expect(result.upstream.cancel).toHaveBeenCalledOnce()
    }
  )
  it('retains exact validated mismatch facts, strips functional output and stops before another frame', async () => {
    const knownFinancial = { ...financial, appliedUsd: '9007199254740993.30000000000000001' }
    const usage = { inputTokens: 0, outputTokens: 3, totalTokens: 7 }
    const wrong: CopilotEvent = {
      ...finished,
      result: {
        ...finished.result,
        financial: knownFinancial,
        usage,
        text: 'Wrong-kind private functional output',
      },
    }
    const result = await projectedRelay([wrong, compacted(true)], 'context.compact')
    expect(result.events).toMatchObject([
      {
        type: 'response.error',
        result: {
          status: 'failed',
          financial: knownFinancial,
          usage,
          error: { code: 'UNCERTAIN' },
        },
      },
    ])
    expect(result.events).toHaveLength(1)
    expect(JSON.stringify(result.events)).not.toContain('Wrong-kind private')
    expect(result.events[0]).not.toHaveProperty('result.text')
    expect(result.events[0]).not.toHaveProperty('result.runId')
    expect(result.upstream.pull).toHaveBeenCalledOnce()
    expect(result.upstream.cancel).toHaveBeenCalledOnce()
    expect(result.abortUpstream).toHaveBeenCalledOnce()
  })
  it.each(['outer', 'nested'] as const)(
    'does not preserve foreign facts after %s correlation fails',
    async (location) => {
      const event =
        location === 'outer'
          ? { ...finished, requestId: 'foreign' }
          : { ...finished, result: { ...finished.result, requestId: 'foreign' } }
      const upstream = source([encoder.encode(frame(event))])
      const abortUpstream = vi.fn()
      await expect(
        new Response(
          relayNativeEvents(upstream.stream, 'CopilotEvent', {
            requestId,
            command: 'context.compact',
            abortUpstream,
          })
        ).text()
      ).rejects.toThrow('does not match')
      expect(abortUpstream).toHaveBeenCalledOnce()
      expect(upstream.cancel).toHaveBeenCalledOnce()
    }
  )
  it('rejects wrong-kind data after a valid terminal without emitting a second safe terminal', async () => {
    const upstream = source([
      encoder.encode(frame(finished)),
      encoder.encode(frame(compacted(true))),
    ])
    const abortUpstream = vi.fn()
    const reader = relayNativeEvents(upstream.stream, 'CopilotEvent', {
      requestId,
      command: 'message',
      abortUpstream,
    }).getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(frame(finished))
    await expect(reader.read()).rejects.toThrow('after its terminal')
    reader.releaseLock()
    expect(abortUpstream).toHaveBeenCalledOnce()
    expect(upstream.cancel).toHaveBeenCalledOnce()
  })
  it('requires the actual Copilot command before acquiring or reading its source', () => {
    const upstream = source([encoder.encode(frame(finished))])
    const abortUpstream = vi.fn()
    expect(() =>
      relayNativeEvents(upstream.stream, 'CopilotEvent', { requestId, abortUpstream })
    ).toThrow('requires its actual native command')
    expect(upstream.stream.locked).toBe(false)
    expect(upstream.pull).not.toHaveBeenCalled()
    expect(abortUpstream).not.toHaveBeenCalled()
  })
  it('keeps a command-bound Copilot relay reader-driven and cancels an untouched source', async () => {
    const upstream = source([encoder.encode(frame(finished))])
    const abortUpstream = vi.fn()
    const stream = relayNativeEvents(upstream.stream, 'CopilotEvent', {
      requestId,
      command: 'message',
      abortUpstream,
    })
    await Promise.resolve()
    expect(upstream.pull).not.toHaveBeenCalled()
    await stream.cancel()
    expect(upstream.cancel).toHaveBeenCalledOnce()
    expect(abortUpstream).toHaveBeenCalledOnce()
  })
})
