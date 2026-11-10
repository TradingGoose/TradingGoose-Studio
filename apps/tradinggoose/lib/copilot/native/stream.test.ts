import { describe, expect, it, vi } from 'vitest'
import type { CompletionEvent, CopilotEvent } from './contract'
import { readNativeEvents } from './stream'

const requestId = 'stream-request'
const financial = {
  accepted: true,
  modelUsd: 'unavailable',
  appliedUsd: '0.30000000000000001',
} as const
const finished: CopilotEvent = {
  type: 'response.completed',
  requestId,
  result: {
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
      requestId,
      text: 'safe',
      headers: { authorization: 'private' },
    },
    { type: 'step-finish', requestId, history: ['private'] },
    { choices: [{ delta: { content: 'raw' } }] },
    {
      type: 'tool.display',
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
    ).rejects.toThrow()
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
      ).rejects.toThrow()
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
      requestId,
      result: {
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
