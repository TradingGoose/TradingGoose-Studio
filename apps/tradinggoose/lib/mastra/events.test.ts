import { Agent } from '@mastra/core/agent'
import { ChunkFrom, type ChunkType } from '@mastra/core/stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectNativeModelEvent } from '@/lib/mastra/events'

afterEach(() => vi.unstubAllGlobals())

const envelope = {
  runId: 'native-private-run',
  from: ChunkFrom.AGENT,
  traceId: 'native-private-trace',
  metadata: { private: 'envelope-secret' },
}

describe('native product stream projection', () => {
  it('emits only intended text and reasoning fields', () => {
    for (const type of ['text-delta', 'reasoning-delta'] as const) {
      expect(
        projectNativeModelEvent({
          ...envelope,
          type,
          payload: {
            id: 'producer-part',
            text: ' exact text\n',
            providerMetadata: { private: { history: 'secret' } },
          },
        })
      ).toEqual({ type, payload: { text: ' exact text\n' } })
    }
  })

  it('keeps intentional tool data and exact IDs without SDK envelope/metadata', () => {
    const args = {
      body: { resumeData: false, __mastraMetadata: { preservedBusinessValue: true } },
      __mastraMetadata: { messages: [{ type: 'text' as const, content: 'private-history' }] },
    }
    expect(
      projectNativeModelEvent({
        ...envelope,
        type: 'tool-call',
        payload: {
          toolCallId: 'call-1',
          toolName: 'public-tool',
          args,
          observability: { traceparent: 'private-carrier' },
          providerMetadata: { private: { secret: 'private-metadata' } },
        },
      })
    ).toEqual({
      type: 'tool-call',
      payload: { toolCallId: 'call-1', toolName: 'public-tool', args: { body: args.body } },
    })
    expect(
      projectNativeModelEvent({
        ...envelope,
        type: 'tool-result',
        payload: {
          toolCallId: 'call-1',
          toolName: 'public-tool',
          result: { output: ['', 'duplicate', 'duplicate'], __mastraMetadata: { private: true } },
          isError: false,
          args,
          providerMetadata: { private: { secret: 'private-metadata' } },
        },
      })
    ).toEqual({
      type: 'tool-result',
      payload: {
        toolCallId: 'call-1',
        toolName: 'public-tool',
        result: { output: ['', 'duplicate', 'duplicate'] },
        isError: false,
      },
    })
    expect(args).toHaveProperty('__mastraMetadata')
  })

  it('projects safe errors and aborts without copying raw error objects or arguments', () => {
    const error = Object.assign(new Error('Request failed: request-secret'), {
      request: { headers: { authorization: 'Bearer upstream-secret' } },
      body: 'private-provider-body',
    })
    expect(
      projectNativeModelEvent({ ...envelope, type: 'error', payload: { error } }, 'request-secret')
    ).toEqual({ type: 'error', payload: { error: 'Request failed: [redacted]' } })
    expect(
      projectNativeModelEvent(
        {
          ...envelope,
          type: 'tool-error',
          payload: {
            toolCallId: 'call-1',
            toolName: 'public-tool',
            error,
            args: { private: true },
          },
        },
        'request-secret'
      )
    ).toEqual({
      type: 'tool-error',
      payload: {
        toolCallId: 'call-1',
        toolName: 'public-tool',
        error: 'Request failed: [redacted]',
      },
    })
    expect(
      projectNativeModelEvent(
        {
          ...envelope,
          type: 'tool-result',
          payload: { toolCallId: 'call-1', toolName: 'public-tool', result: error, isError: true },
        },
        'request-secret'
      )
    ).toEqual({
      type: 'tool-result',
      payload: {
        toolCallId: 'call-1',
        toolName: 'public-tool',
        result: { error: 'Request failed: [redacted]' },
        isError: true,
      },
    })
    expect(
      projectNativeModelEvent({ ...envelope, type: 'abort', payload: { private: true } })
    ).toEqual({
      type: 'abort',
      payload: {},
    })
  })

  it('suppresses every other diagnostic/lifecycle/history/structured SDK event', () => {
    for (const type of [
      'start',
      'step-start',
      'step-finish',
      'finish',
      'raw',
      'object',
      'object-result',
      'source',
      'file',
      'reasoning-signature',
      'redacted-reasoning',
      'data-private',
      'tool-call-approval',
      'tool-call-suspended',
      'workflow-step-result',
      'unknown-future-event',
    ]) {
      expect(
        projectNativeModelEvent({
          ...envelope,
          type,
          payload: { history: 'secret', headers: { authorization: 'private' } },
        } as ChunkType<unknown>)
      ).toBeNull()
    }
  })

  it('filters real installed fetch-adapter success envelopes that contain private headers and history', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      const frames = [
        {
          id: 'fixture-response',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'listed',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Public answer' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'fixture-response',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'listed',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        },
      ]
      return new Response(
        `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-private-header': 'fixture-upstream-private-header',
          },
        }
      )
    })
    const agent = new Agent({
      id: 'event-projection-fixture',
      name: 'Event fixture',
      instructions: 'fixture-private-instructions',
      model: {
        providerId: 'fixture',
        modelId: 'listed',
        url: 'http://fixture.invalid/v1',
        apiKey: 'fixture-request-key',
      },
      maxRetries: 0,
      errorProcessorDefaults: false,
      errorProcessors: [],
      defaultOptions: { errorProcessors: [] },
    })
    const output = await agent.stream([{ role: 'user', content: 'fixture-private-history' }], {
      modelSettings: { maxRetries: 0 },
      maxProcessorRetries: 0,
    })
    const raw: ChunkType[] = []
    for await (const event of output.fullStream) raw.push(event)
    const actual = JSON.stringify(raw)
    expect(calls).toBe(1)
    expect(actual).toContain('fixture-upstream-private-header')
    expect(actual).toContain('fixture-private-history')
    const projected = raw
      .map((event) => projectNativeModelEvent(event, 'fixture-request-key'))
      .filter(Boolean)
    expect(projected).toEqual([{ type: 'text-delta', payload: { text: 'Public answer' } }])
    const serialized = JSON.stringify(projected)
    for (const secret of [
      'fixture-upstream-private-header',
      'fixture-private-history',
      'fixture-private-instructions',
      'fixture-request-key',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect((await output.getFullOutput()).text).toBe('Public answer')
  })
})
