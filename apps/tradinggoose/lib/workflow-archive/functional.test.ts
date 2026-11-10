import { describe, expect, it, vi } from 'vitest'
import { withInferenceFacts } from '@/lib/mastra/result'
import type { NativePayloadRef } from '@/lib/mastra/workflow-history'
import { checkpointFunctionalOutput } from '@/executor/checkpoint'
import { extractCompletedToolMetadata } from '@/executor/handlers/agent/agent-handler'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/mastra/workflow-history', () => ({
  readFunctionalPayload: (...args: unknown[]) => mocks.read(...args),
}))

import {
  functionalOutput,
  hydrateCheckpointFunctionalPayloads,
  hydrateFunctionalBlocks,
  projectFunctionalBlocks,
} from './functional'

const ref: NativePayloadRef = {
  version: 1,
  purpose: 'workflow-agent',
  workspaceId: 'w',
  executionId: 'e',
  logId: 'l',
  blockId: 'a',
  runId: 'r',
  resourceId: 'workflow-agent:r',
  threadId: 'workflow-agent:t',
  messageIds: ['message'],
  digest: 'digest',
}
describe('canonical functional Records projection', () => {
  it('hydrates exact actual tool args/results without exposing internal refs or copying native report totals', async () => {
    const actual = {
      id: 'tool',
      toolCallId: 'call',
      name: 'fixed tool',
      arguments: { fixed: 'approved' },
      result: { content: 'actual', tokens: 'intentional business field' },
      startTime: '2026-01-01',
      endTime: '2026-01-01',
      duration: 1,
      success: true,
    }
    mocks.read.mockResolvedValue({
      selectedMessages: [{ role: 'system', content: 'exact' }],
      tools: [actual],
      output: { tokens: 9, model: 'business' },
    })
    const spans = await hydrateFunctionalBlocks([
      {
        id: 'a',
        name: 'Agent',
        type: 'agent',
        blockId: 'a',
        duration: 1,
        startTime: '2026-01-01',
        endTime: '2026-01-01',
        nativePayload: ref,
      },
    ])
    expect(spans[0].output).toEqual({ tokens: 9, model: 'business' })
    expect(spans[0].toolCalls?.[0]).toEqual({
      id: 'call',
      name: 'fixed tool',
      duration: 1,
      startTime: '2026-01-01',
      endTime: '2026-01-01',
      status: 'success',
      input: { fixed: 'approved' },
      output: actual.result,
    })
    expect(spans[0]).not.toHaveProperty('nativePayload')
    expect(spans[0]).not.toHaveProperty('inference')
  })
  it('keeps schema-owned names while removing only known generated native report envelopes', () => {
    const output = { model: 'schema', tokens: 7, cost: { business: true }, nested: { tokens: 8 } }
    expect(functionalOutput(output, { generatedFields: [] })).toEqual(output)
    expect(
      functionalOutput({ content: 'answer', tokens: { total: 7 } }, { generatedFields: ['tokens'] })
    ).toEqual({ content: 'answer' })
    const report = withInferenceFacts(
      { content: 'tool answer', tokens: { total: 7 }, cost: { status: 'unavailable' } },
      { generatedFields: ['tokens', 'cost'] }
    )
    const projected = projectFunctionalBlocks([
      {
        id: 'a',
        name: 'tool',
        type: 'tool',
        duration: 1,
        startTime: 'start',
        endTime: 'end',
        output: { wrapped: report },
        children: [],
      },
    ])
    expect(projected[0].output).toEqual({ wrapped: { content: 'tool answer' } })
  })
  it('rejects malformed native functional tool occurrences instead of manufacturing durations or results', async () => {
    mocks.read.mockResolvedValue({
      tools: [{ name: 'unknown', result: 'x' }],
      output: { content: 'answer' },
    })
    await expect(
      hydrateFunctionalBlocks([
        {
          id: 'a',
          name: 'Agent',
          type: 'agent',
          duration: 1,
          startTime: 'start',
          endTime: 'end',
          nativePayload: ref,
        },
      ])
    ).rejects.toThrow('malformed')
  })
})

describe('checkpoint generated tool results preserve live membership', () => {
  const snapshot = (generatedFields = ['toolResults', 'toolCalls']) =>
    ({
      executor: {
        context: {
          blockLogs: [
            {
              id: 'functional.test.ts:saved-occurrence:1',
              blockId: 'a',
              inference: { nativePayload: ref, generatedFields, model: 'native' },
              output: {},
            },
          ],
          blockStates: [['a', { executed: true, output: {} }]],
        },
        currentBlockStates: { a: {} },
      },
    }) as any
  const scope = { workspaceId: 'w', executionId: 'e', logId: 'l' }
  it('retains selected success/known-cost/token failures and all failed canonical history in exact order', async () => {
    const tools = [
      { toolCallId: 'duplicate', success: true },
      { toolCallId: 'ordinary', success: false, result: { error: 'ordinary failure' } },
      { toolCallId: 'duplicate', success: false, result: { content: 'incurred-cost-kept' } },
      { toolCallId: 'tokens', success: false, result: { content: 'known-usage-kept' } },
      { toolCallId: 'null', success: true, result: null },
      { toolCallId: 'primitive', success: true, result: 'exact' },
    ]
    mocks.read.mockResolvedValue({
      tools,
      toolResultIndexes: [0, 2, 3, 4, 5],
      output: { content: 'answer' },
    })
    const value = await hydrateCheckpointFunctionalPayloads(snapshot(), scope)
    const expected = {
      content: 'answer',
      toolCalls: { list: tools, count: tools.length },
      toolResults: [
        undefined,
        { content: 'incurred-cost-kept', toolCallId: 'duplicate' },
        { content: 'known-usage-kept', toolCallId: 'tokens' },
        null,
        'exact',
      ],
    }
    expect(value.executor.context.blockLogs[0].output).toEqual(expected)
    expect(value.executor.context.blockStates[0][1].output).toEqual(expected)
    expect(value.executor.currentBlockStates.a).toEqual(expected)
    expect(value.executor.context.blockLogs[0].output.toolCalls.list[1]).toBe(tools[1])
  })
  it.each(
    [undefined, null, [1], [-1], [0.5], [0, 0], [1, 0], ['0'], [Number.MAX_SAFE_INTEGER + 1]].map(
      (value) => [value]
    )
  )('refuses missing/malformed selection %j', async (indexes) => {
    mocks.read.mockResolvedValue({
      tools: [{ success: true, result: 'kept' }],
      toolResultIndexes: indexes,
      output: {},
    })
    await expect(hydrateCheckpointFunctionalPayloads(snapshot(), scope)).rejects.toThrow(
      'membership is missing or malformed'
    )
  })
  it.each([null, [], false, { business: 'owned' }].map((value) => [value]))(
    'keeps schema-owned toolResults %j and toolCalls untouched',
    async (toolResults) => {
      const output = { toolResults, toolCalls: { schema: 'owned' } }
      mocks.read.mockResolvedValue({
        output,
        tools: [{ success: false, result: { error: 'retained' } }],
      })
      const value = await hydrateCheckpointFunctionalPayloads(snapshot([]), scope)
      expect(value.executor.context.blockLogs[0].output).toEqual(output)
    }
  )
})

it('matches actual live handler output through branded diagnostic stripping and checkpoint hydration', async () => {
  const tools = [
    { toolCallId: 'ok', success: true, result: { value: 'success' } },
    { toolCallId: 'ordinary', success: false, result: { error: 'ordinary failure' } },
    {
      toolCallId: 'known-cost',
      success: false,
      result: withInferenceFacts(
        { error: 'incurred failure', cost: { total: 1 }, value: 'functional' },
        { generatedFields: ['cost'] }
      ),
    },
    {
      toolCallId: 'known-tokens',
      success: false,
      result: withInferenceFacts(
        { tokens: { total: 2 }, value: 'usage-completed' },
        { generatedFields: ['tokens'] }
      ),
    },
    { toolCallId: 'zero', success: false, result: { cost: 0, tokens: 0 } },
  ]
  const expected = checkpointFunctionalOutput(extractCompletedToolMetadata(tools)).toolResults
  mocks.read.mockResolvedValue({
    output: {},
    tools: checkpointFunctionalOutput(tools),
    toolResultIndexes: [0, 2, 3],
  })
  const snapshot = {
    executor: {
      context: {
        blockLogs: [
          {
            id: 'functional.test.ts:saved-occurrence:2',
            blockId: 'a',
            inference: { nativePayload: ref, generatedFields: ['toolResults'] },
          },
        ],
        blockStates: [],
      },
      currentBlockStates: {},
    },
  } as any
  const actual = await hydrateCheckpointFunctionalPayloads(snapshot, {
    workspaceId: 'w',
    executionId: 'e',
    logId: 'l',
  })
  expect(actual.executor.context.blockLogs[0].output.toolResults).toEqual(expected)
  expect(expected).toEqual([
    { value: 'success', toolCallId: 'ok' },
    { error: 'incurred failure', value: 'functional', toolCallId: 'known-cost' },
    { value: 'usage-completed', toolCallId: 'known-tokens' },
  ])
})

it('restores each hot and JSON-cold checkpoint destination against its own saved functional authority', async () => {
  mocks.read.mockResolvedValue({
    output: { error: 'canonical failure', fallback: ' exact🔥\n ' },
    tools: [],
  })
  for (const cold of [false, true]) {
    const facts = { nativePayload: ref, generatedFields: [] }
    const value = {
      executor: {
        context: {
          blockLogs: [
            {
              id: 'functional.test.ts:saved-occurrence:3',
              blockId: 'a',
              success: false,
              error: 'log error',
              inference: facts,
              output: { error: 'saved log error', logOnly: true },
            },
          ],
          blockStates: [
            [
              'a',
              {
                executed: true,
                output: { error: 'saved state error', status: 500, stateOnly: true },
              },
            ],
            ['untouched', { output: { keep: true } }],
          ],
        },
        currentBlockStates: {
          a: { error: 'saved current error', status: 503, currentOnly: true },
          untouched: { keep: true },
        },
      },
    }
    const snapshot = (cold ? JSON.parse(JSON.stringify(value)) : value) as any
    await hydrateCheckpointFunctionalPayloads(snapshot, {
      workspaceId: 'w',
      executionId: 'e',
      logId: 'l',
    })
    expect(snapshot.executor.context.blockLogs[0]).toMatchObject({
      success: false,
      error: 'log error',
      output: { error: 'saved log error', fallback: ' exact🔥\n ', logOnly: true },
    })
    expect(snapshot.executor.context.blockLogs[0].output).not.toHaveProperty('status')
    expect(snapshot.executor.context.blockStates).toEqual([
      [
        'a',
        {
          executed: true,
          output: {
            error: 'saved state error',
            fallback: ' exact🔥\n ',
            status: 500,
            stateOnly: true,
          },
        },
      ],
      ['untouched', { output: { keep: true } }],
    ])
    expect(snapshot.executor.currentBlockStates).toEqual({
      a: { error: 'saved current error', fallback: ' exact🔥\n ', status: 503, currentOnly: true },
      untouched: { keep: true },
    })
    expect(snapshot.executor.context.blockStates[0][1].output).not.toBe(
      snapshot.executor.context.blockLogs[0].output
    )
    expect(snapshot.executor.currentBlockStates.a).not.toBe(
      snapshot.executor.context.blockStates[0][1].output
    )
  }
})

it('refuses missing, nonstring and duplicate functional IDs before reading any canonical payload', async () => {
  const valid = {
    id: 'valid',
    name: 'Agent',
    type: 'agent',
    blockId: 'a',
    duration: 0,
    startTime: '2026-11-10',
    endTime: '2026-11-10',
    nativePayload: ref,
  }
  for (const id of [undefined, null, '', '  ', 1, {}]) {
    mocks.read.mockClear()
    const invalid = { ...valid }
    Reflect.set(invalid, 'id', id)
    await expect(hydrateFunctionalBlocks([valid, invalid])).rejects.toThrow(
      'functional block occurrence'
    )
    expect(mocks.read).not.toHaveBeenCalled()
    expect(() => projectFunctionalBlocks([valid, invalid])).toThrow('functional block occurrence')
  }
  mocks.read.mockClear()
  await expect(hydrateFunctionalBlocks([valid, { ...valid }])).rejects.toThrow(
    'functional block occurrence'
  )
  expect(mocks.read).not.toHaveBeenCalled()
  expect(() => projectFunctionalBlocks([valid, { ...valid }])).toThrow(
    'functional block occurrence'
  )
})

it('retains plain/null-prototype functional IDs and nested toJSON-named business values without normalization', async () => {
  const output = {
    toJSON: 'schema-owned',
    nested: { toJSON: { literal: true }, id: 'business id' },
  }
  for (const prototype of [Object.prototype, null]) {
    const id = '  exact opaque functional id🔥  '
    const entry = Object.assign(Object.create(prototype), {
      id,
      name: 'Variables',
      type: 'variables',
      blockId: 'v',
      duration: 0,
      startTime: '2026-11-10',
      endTime: '2026-11-10',
      output,
    })
    const projected = projectFunctionalBlocks([entry])
    expect(projected[0].id).toBe(id)
    expect(projected[0].output).toEqual(output)
    const restored = await hydrateFunctionalBlocks(JSON.parse(JSON.stringify(projected)))
    expect(restored[0].id).toBe(id)
    expect(restored[0].output).toEqual(output)
  }
})
