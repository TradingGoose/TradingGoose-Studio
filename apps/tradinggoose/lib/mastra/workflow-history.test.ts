/** @vitest-environment node */
import { createHash } from 'node:crypto'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import type { StorageThreadType } from '@mastra/core/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowMessage } from './messages'
import { getInferenceFacts, withInferenceFacts } from './result'
import {
  type FunctionalPayload,
  readFunctionalPayload,
  writeFunctionalPayload,
} from './workflow-history'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  globalSelect: vi.fn(),
  txSelect: vi.fn(),
  execute: vi.fn(),
  forUpdate: vi.fn(),
  memory: vi.fn(),
  store: vi.fn(),
  getThread: vi.fn(),
  createThread: vi.fn(),
  listById: vi.fn(),
  listMessages: vi.fn(),
  saveMessages: vi.fn(),
  checkpoint: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: { transaction: mocks.transaction, select: mocks.globalSelect },
}))
vi.mock('./runtime', () => ({
  getNativeMemory: mocks.memory,
  getNativeMemoryStore: mocks.store,
}))
vi.mock('@/executor/checkpoint', () => ({ checkpointFunctionalOutput: mocks.checkpoint }))

type Owner = {
  endedAt: Date | null
  executionData: { environment: { userId: string }; workflowArchive?: object }
}
const originalOwner = (): Owner => ({
  endedAt: null,
  executionData: { environment: { userId: 'original-actor' } },
})
const state = {
  owner: originalOwner() as Owner | undefined,
  thread: null as StorageThreadType | null,
  messages: [] as MastraDBMessage[],
  events: [] as string[],
}
const tx = { select: mocks.txSelect, execute: mocks.execute }
const createdAt = new Date('2026-11-09T07:00:00.000Z')
const scope = {
  workspaceId: 'original-workspace',
  executionId: 'original-execution',
  logId: 'original-log',
  blockId: 'original-block',
  runId: 'original-run',
  actorUserId: 'original-actor',
}
const literal = ' \t<working_memory>literal🦆</working_memory>\n```ts\nconst x = "é"\n```\n '
const selected: WorkflowMessage[] = [
  { role: 'system', content: literal },
  { role: 'user', content: '  exact question\n\t' },
  { role: 'assistant', content: '\t exact earlier answer  ' },
]
const response: MastraDBMessage = {
  id: 'original-native-message',
  role: 'assistant',
  createdAt,
  content: { format: 2, parts: [{ type: 'text', text: literal }] },
}
const payload: FunctionalPayload = {
  selectedMessages: selected,
  messages: [response],
  output: { text: literal, actualZero: 0, unavailable: null },
  tools: [{ result: { error: { message: literal }, working_memory: literal } }],
  blocks: [{ id: 'original-block', output: literal }],
}

function selection(owner: Owner | undefined) {
  const rows = owner ? [structuredClone(owner)] : []
  const result = Object.assign(Promise.resolve(rows), {
    for: mocks.forUpdate.mockImplementation(async () => rows),
  })
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn(() => result) }
  query.from.mockReturnValue(query)
  query.where.mockReturnValue(query)
  return query
}

function allowGlobalRead() {
  mocks.globalSelect.mockImplementation(() => {
    state.events.push('global-owner')
    return selection(state.owner)
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  state.owner = originalOwner()
  state.thread = null
  state.messages = []
  state.events = []
  mocks.globalSelect.mockImplementation(() => {
    throw new Error('Global database re-entry during locked payload write')
  })
  mocks.transaction.mockImplementation(async (callback) => callback(tx))
  mocks.txSelect.mockImplementation(() => selection(state.owner))
  mocks.execute.mockResolvedValue([])
  mocks.checkpoint.mockImplementation((value) => value)
  mocks.getThread.mockImplementation(async () => {
    state.events.push('native-thread')
    return structuredClone(state.thread)
  })
  mocks.createThread.mockImplementation(async (input) => {
    state.thread = {
      id: input.threadId,
      resourceId: input.resourceId,
      metadata: structuredClone(input.metadata),
      title: input.title,
      createdAt,
      updatedAt: createdAt,
    }
    return structuredClone(state.thread)
  })
  mocks.listById.mockImplementation(async ({ messageIds }: { messageIds: string[] }) => {
    state.events.push('native-messages')
    return {
      messages: structuredClone(
        state.messages.filter((message) => messageIds.includes(message.id))
      ),
    }
  })
  mocks.saveMessages.mockImplementation(async ({ messages }: { messages: MastraDBMessage[] }) => {
    const current = new Map(state.messages.map((message) => [message.id, message]))
    for (const message of messages) current.set(message.id, structuredClone(message))
    state.messages = [...current.values()]
    return { messages: structuredClone(messages) }
  })
  mocks.listMessages.mockImplementation(async ({ page, perPage }) => {
    state.events.push('native-messages')
    return {
      messages: structuredClone(state.messages.slice(page * perPage, (page + 1) * perPage)),
      page,
      perPage,
      total: state.messages.length,
      hasMore: (page + 1) * perPage < state.messages.length,
    }
  })
  mocks.memory.mockResolvedValue({
    getThreadById: mocks.getThread,
    createThread: mocks.createThread,
  })
  mocks.store.mockResolvedValue({
    getThreadById: mocks.getThread,
    listMessagesById: mocks.listById,
    saveMessages: mocks.saveMessages,
    listMessages: mocks.listMessages,
  })
})

describe('canonical workflow payload transaction ownership', () => {
  it('keeps write ownership, locks and exact readback on the existing transaction', async () => {
    const ref = await writeFunctionalPayload(scope, payload)
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.globalSelect).not.toHaveBeenCalled()
    expect(mocks.txSelect.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(mocks.forUpdate).toHaveBeenCalledExactlyOnceWith('update')
    expect(mocks.execute).toHaveBeenCalledTimes(ref.messageIds.length)
    expect(mocks.saveMessages).toHaveBeenCalledOnce()
    expect(mocks.listMessages).not.toHaveBeenCalled()
    expect(mocks.listById).toHaveBeenCalledTimes(2)
    expect(ref.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(state.messages.map(({ id }) => id)).toEqual(ref.messageIds)

    const restored = await readFunctionalPayload(ref, tx)
    expect(restored.selectedMessages).toEqual(selected)
    expect(restored.messages?.[0].content.parts).toEqual(response.content.parts)
    expect(restored.output).toEqual(payload.output)
    expect(restored.tools).toEqual(payload.tools)
    expect(restored.blocks).toEqual(payload.blocks)
    expect(mocks.globalSelect).not.toHaveBeenCalled()
  })

  it('freshly checks the global owner before and after standalone native reads', async () => {
    const ref = await writeFunctionalPayload(scope, payload)
    state.events = []
    mocks.txSelect.mockClear()
    allowGlobalRead()
    const restored = await readFunctionalPayload(ref)
    expect(restored.selectedMessages).toEqual(selected)
    expect(restored.messages?.[0].content.parts).toEqual(response.content.parts)
    expect(state.events).toEqual([
      'global-owner',
      'native-thread',
      'native-messages',
      'global-owner',
      'global-owner',
    ])
    expect(mocks.txSelect).not.toHaveBeenCalled()
    expect(mocks.globalSelect).toHaveBeenCalledTimes(3)
  })

  it.each(['before-read', 'after-read', 'after-projection'])(
    'refuses a missing current owner %s without returning a payload',
    async (stage) => {
      const ref = await writeFunctionalPayload(scope, payload)
      state.events = []
      mocks.getThread.mockClear()
      mocks.listById.mockClear()
      allowGlobalRead()
      const missingAt = ['before-read', 'after-read', 'after-projection'].indexOf(stage) + 1
      let reads = 0
      mocks.globalSelect.mockImplementation(() =>
        selection(++reads === missingAt ? undefined : state.owner)
      )
      await expect(readFunctionalPayload(ref)).rejects.toThrow('owning execution is unavailable')
      expect(mocks.globalSelect).toHaveBeenCalledTimes(missingAt)
      if (stage === 'before-read') {
        expect(mocks.getThread).not.toHaveBeenCalled()
        expect(mocks.listById).not.toHaveBeenCalled()
      } else {
        expect(mocks.getThread).toHaveBeenCalledOnce()
        expect(mocks.listById).toHaveBeenCalledOnce()
      }
    }
  )

  it('refuses a different invocation actor before native mutation', async () => {
    await expect(
      writeFunctionalPayload({ ...scope, actorUserId: 'different-actor' }, payload)
    ).rejects.toThrow('actor does not own')
    expect(mocks.globalSelect).not.toHaveBeenCalled()
    expect(mocks.memory).not.toHaveBeenCalled()
    expect(mocks.saveMessages).not.toHaveBeenCalled()
  })

  it('refuses a native thread whose original ownership metadata changed', async () => {
    const ref = await writeFunctionalPayload(scope, payload)
    if (!state.thread) throw new Error('Expected created native thread')
    state.thread.metadata = { ...state.thread.metadata, runId: 'different-run' }
    allowGlobalRead()
    await expect(readFunctionalPayload(ref)).rejects.toThrow('thread is unavailable or mismatched')
  })

  it('refuses changed literal bytes against the original canonical digest', async () => {
    const ref = await writeFunctionalPayload(scope, payload)
    state.messages[0].content.parts = [{ type: 'text', text: literal.trim() }]
    allowGlobalRead()
    await expect(readFunctionalPayload(ref)).rejects.toThrow('readback digest/count mismatch')
  })

  it('keeps distinct same-thread candidates readable through their own exact references', async () => {
    const original = await writeFunctionalPayload(scope, payload)
    const nextPayload = { ...payload, output: { changed: 'successor' } }
    const next = await writeFunctionalPayload(scope, nextPayload)
    expect(next.threadId).toBe(original.threadId)
    expect(next.messageIds.every((id) => !original.messageIds.includes(id))).toBe(true)
    expect((await readFunctionalPayload(original, tx)).output).toEqual(payload.output)
    expect((await readFunctionalPayload(next, tx)).output).toEqual(nextPayload.output)
    expect(mocks.saveMessages).toHaveBeenCalledTimes(2)
    expect(mocks.listMessages).not.toHaveBeenCalled()
    expect(mocks.globalSelect).not.toHaveBeenCalled()
  })

  it('reads retained deterministic v1 IDs through the same opaque exact-reference path', async () => {
    const ref = await writeFunctionalPayload(scope, payload)
    let input = 0
    let response = 0
    // A retained v1 fixture: no production legacy writer, prefix parser or backfill path.
    state.messages = state.messages.map((message) => ({
      ...message,
      id:
        message.content.metadata?.workflowSection === 'functional'
          ? `${ref.threadId}:functional`
          : `${ref.threadId}:${message.content.metadata?.workflowSection}:${String(
              message.content.metadata?.workflowSection === 'input' ? input++ : response++
            ).padStart(12, '0')}`,
    }))
    const retained = {
      ...ref,
      messageIds: state.messages.map(({ id }) => id),
      digest: createHash('sha256')
        .update(
          JSON.stringify(
            state.messages.map((message) => [
              message.id,
              message.role,
              message.threadId,
              message.resourceId,
              new Date(message.createdAt).toISOString(),
              message.content,
            ])
          )
        )
        .digest('hex'),
    }
    const restored = await readFunctionalPayload(retained, tx)
    expect(restored.output).toEqual(payload.output)
    expect(restored.selectedMessages).toEqual(selected)
    expect(restored.messages?.[0].content.parts).toEqual(payload.messages?.[0].content.parts)
    expect(mocks.saveMessages).toHaveBeenCalledOnce()
    expect(mocks.listMessages).not.toHaveBeenCalled()
  })

  it('refuses a visible foreign global-ID collision before any native message upsert', async () => {
    mocks.listById.mockImplementationOnce(async ({ messageIds }) => ({
      messages: [{ ...response, id: messageIds[0], threadId: 'foreign', resourceId: 'foreign' }],
    }))
    await expect(writeFunctionalPayload(scope, payload)).rejects.toThrow(
      'Immutable workflow payload'
    )
    expect(mocks.saveMessages).not.toHaveBeenCalled()
  })

  it('confirms a committed save with lost acknowledgement using only its original candidate IDs', async () => {
    const save = mocks.saveMessages.getMockImplementation()!
    const acknowledgement = new Error('save acknowledgement lost')
    mocks.saveMessages.mockImplementationOnce(async (args) => {
      await save(args)
      throw acknowledgement
    })
    const ref = await writeFunctionalPayload(scope, payload)
    expect(mocks.saveMessages).toHaveBeenCalledOnce()
    expect(state.messages.map(({ id }) => id)).toEqual(ref.messageIds)
    expect((await readFunctionalPayload(ref, tx)).output).toEqual(payload.output)
  })

  it('preserves an unconfirmed native failure without retrying or manufacturing another candidate', async () => {
    const error = new Error('uncertain native mutation')
    mocks.saveMessages.mockRejectedValueOnce(error)
    await expect(writeFunctionalPayload(scope, payload)).rejects.toBe(error)
    expect(mocks.saveMessages).toHaveBeenCalledOnce()
    expect(state.messages).toEqual([])
  })

  it('reads more than one exact-ID batch in reference order despite reversed native results', async () => {
    const selectedMessages = Array.from({ length: 211 }, (_, index) => ({
      role: 'user' as const,
      content: index % 2 ? '' : `duplicate literal ${index % 4}`,
    }))
    const ref = await writeFunctionalPayload(scope, { ...payload, selectedMessages })
    mocks.listById.mockClear().mockImplementation(async ({ messageIds }) => ({
      messages: structuredClone(
        state.messages.filter((message) => messageIds.includes(message.id)).reverse()
      ),
    }))
    const restored = await readFunctionalPayload(ref, tx)
    expect(restored.selectedMessages).toEqual(selectedMessages)
    expect(mocks.listById).toHaveBeenCalledTimes(3)
    expect(mocks.listById.mock.calls.every(([args]) => args.messageIds.length <= 100)).toBe(true)
  })

  it.each(['empty', 'duplicate', 'missing', 'unexpected', 'foreign', 'invalid-date'])(
    'refuses %s exact references/results without accepting a partial payload',
    async (kind) => {
      const ref = await writeFunctionalPayload(scope, payload)
      if (kind === 'empty') ref.messageIds = []
      else if (kind === 'duplicate') ref.messageIds[1] = ref.messageIds[0]
      else
        mocks.listById.mockImplementation(async ({ messageIds }) => {
          const messages = structuredClone(
            state.messages.filter((message) => messageIds.includes(message.id))
          )
          if (kind === 'missing') messages.pop()
          else if (kind === 'unexpected') messages[0].id = 'not-requested'
          else if (kind === 'foreign') messages[0].resourceId = 'foreign'
          else messages[0].createdAt = new Date(Number.NaN)
          return { messages }
        })
      await expect(readFunctionalPayload(ref, tx)).rejects.toThrow(/reference|digest\/count/)
    }
  )

  it.each(['missing', 'ended', 'archived'])(
    'refuses a %s owner before starting any native write',
    async (closed) => {
      if (closed === 'missing') state.owner = undefined
      else if (closed === 'ended') state.owner = { ...originalOwner(), endedAt: createdAt }
      else
        state.owner = {
          ...originalOwner(),
          executionData: { ...originalOwner().executionData, workflowArchive: { preserved: true } },
        }
      await expect(writeFunctionalPayload(scope, payload)).rejects.toThrow('writer is closed')
      expect(mocks.globalSelect).not.toHaveBeenCalled()
      expect(mocks.memory).not.toHaveBeenCalled()
      expect(mocks.store).not.toHaveBeenCalled()
      expect(mocks.execute).not.toHaveBeenCalled()
      expect(mocks.saveMessages).not.toHaveBeenCalled()
    }
  )
})

describe('functional native metadata and pre-stripping result membership', () => {
  it('retains exact nonerror provider metadata and rejects its later mutation', async () => {
    const parts = [
      {
        type: 'reasoning',
        reasoning: literal,
        details: [],
        providerMetadata: { native: { signature: 'reasoning-signature' } },
      },
      {
        type: 'file',
        mimeType: 'image/png',
        data: 'data:image/png;base64,AA==',
        providerMetadata: { native: { signature: 'image-signature' } },
      },
      {
        type: 'text',
        text: literal,
        providerMetadata: { native: { literal: ' text signature ' } },
      },
      {
        type: 'error',
        providerMetadata: { secret: { key: 'diagnostic-secret' } },
        error: { name: 'ProviderError', message: 'diagnostic-secret' },
      },
    ] as MastraDBMessage['content']['parts']
    const contentMetadata = { native: { cache: 'functional-content-metadata' } }
    const ref = await writeFunctionalPayload(scope, {
      ...payload,
      messages: [{ ...response, content: { format: 2, providerMetadata: contentMetadata, parts } }],
    })
    const restored = await readFunctionalPayload(ref, tx)
    expect(restored.messages?.[0].content.providerMetadata).toEqual(contentMetadata)
    expect(restored.messages?.[0].content.parts.slice(0, 3)).toEqual(parts.slice(0, 3))
    expect(JSON.stringify(restored)).not.toContain('diagnostic-secret')
    const saved = state.messages.find(
      (message) => message.content.metadata?.workflowSection === 'response'
    )!
    saved.content.parts[0].providerMetadata = { native: { signature: 'changed' } }
    await expect(readFunctionalPayload(ref, tx)).rejects.toThrow('digest/count mismatch')
  })
  it('records exact ordered live membership before report stripping, keeping every tool run', async () => {
    const tools = [
      { toolCallId: 'same', success: true, result: undefined },
      { toolCallId: 'same', success: false, result: { error: 'ordinary' } },
      { toolCallId: 'cost', success: false, result: { cost: { total: 1 }, value: 'incurred' } },
      { toolCallId: 'tokens', success: false, result: { tokens: { total: 2 }, value: 'used' } },
      { toolCallId: 'zero', success: false, result: { cost: 0, tokens: 0 } },
      { toolCallId: 'empty-cost', success: false, result: { cost: {} } },
      { toolCallId: 'null', success: true, result: null },
    ]
    mocks.checkpoint.mockImplementation((value) =>
      Array.isArray(value)
        ? value.map((run) => ({
            ...run,
            result:
              run.result && typeof run.result === 'object'
                ? Object.fromEntries(
                    Object.entries(run.result).filter(([key]) => key !== 'cost' && key !== 'tokens')
                  )
                : run.result,
          }))
        : value
    )
    const ref = await writeFunctionalPayload(scope, { ...payload, tools })
    const restored = await readFunctionalPayload(ref, tx)
    expect(restored.toolResultIndexes).toEqual([0, 2, 3, 5, 6])
    expect(restored.tools).toHaveLength(tools.length)
    expect((restored.tools as any[])[1].result).toEqual({ error: 'ordinary' })
    expect((restored.tools as any[])[2].result).toEqual({ value: 'incurred' })
  })
})

it('projects a copy of nested branded final outputs before actual persistence while preserving live facts and schema fields', async () => {
  const { checkpointFunctionalOutput } =
    await vi.importActual<typeof import('@/executor/checkpoint')>('@/executor/checkpoint')
  mocks.checkpoint.mockImplementation(checkpointFunctionalOutput)
  const facts = {
    model: 'native-model',
    generatedFields: [
      'model',
      'tokens',
      'cost',
      'toolCost',
      'unavailableToolCosts',
      'providerTiming',
    ],
  }
  const agent = withInferenceFacts(
    {
      model: 'native-model',
      content: literal,
      tokens: { total: 7 },
      cost: { status: 'unavailable' },
      toolCost: 1,
      unavailableToolCosts: 2,
      providerTiming: { duration: 3 },
    },
    facts
  )
  const evaluator = withInferenceFacts(
    { model: 'eval', result: literal, tokens: { total: 2 }, cost: { status: 'unavailable' } },
    { generatedFields: ['model', 'tokens', 'cost'] }
  )
  const router = withInferenceFacts(
    {
      model: 'router',
      prompt: literal,
      selectedPath: { blockId: 'next' },
      tokens: { total: 1 },
      cost: { status: 'unavailable' },
    },
    { generatedFields: ['model', 'tokens', 'cost'] }
  )
  const schemaOwned = withInferenceFacts(
    {
      tokens: 'business tokens',
      cost: 'business cost',
      providerTiming: 'business timing',
      model: 'business model',
    },
    { generatedFields: [] }
  )
  const output = {
    agent,
    evaluator,
    router,
    nested: { schemaOwned },
    unbranded: { tokens: 7, cost: 0, providerTiming: literal },
  }
  const originalFacts = getInferenceFacts(agent)
  const ref = await writeFunctionalPayload(scope, {
    ...payload,
    output,
    tools: [{ success: false, result: agent }],
  })
  const stored = await readFunctionalPayload(ref, tx)
  expect(stored.output).toEqual({
    agent: { model: 'native-model', content: literal },
    evaluator: { model: 'eval', result: literal },
    router: { model: 'router', prompt: literal, selectedPath: { blockId: 'next' } },
    nested: {
      schemaOwned: {
        tokens: 'business tokens',
        cost: 'business cost',
        providerTiming: 'business timing',
        model: 'business model',
      },
    },
    unbranded: { tokens: 7, cost: 0, providerTiming: literal },
  })
  expect(stored.toolResultIndexes).toEqual([0])
  expect(stored.tools).toEqual([
    { success: false, result: { model: 'native-model', content: literal } },
  ])
  expect(agent.tokens).toEqual({ total: 7 })
  expect(agent.toolCost).toBe(1)
  expect(getInferenceFacts(agent)).toBe(originalFacts)
  expect(getInferenceFacts(schemaOwned)?.generatedFields).toEqual([])
})

it.each([
  { blocks: [{}] },
  { blocks: [{ id: '' }] },
  { blocks: [{ id: '   ' }] },
  { blocks: [{ id: 1 }] },
  { blocks: [{ id: null }] },
  { blocks: [{ id: 'same' }, { id: 'same' }] },
])('refuses malformed functional block IDs before native contact: %j', async ({ blocks }) => {
  await expect(writeFunctionalPayload(scope, { ...payload, blocks })).rejects.toThrow(
    'functional block occurrence'
  )
  expect(mocks.memory).not.toHaveBeenCalled()
  expect(mocks.store).not.toHaveBeenCalled()
  expect(mocks.getThread).not.toHaveBeenCalled()
  expect(mocks.createThread).not.toHaveBeenCalled()
  expect(mocks.saveMessages).not.toHaveBeenCalled()
})

it('refuses inherited and unserializable occurrence envelopes before any native contact', async () => {
  const cases: Array<[string, (value: Record<string, unknown>) => unknown]> = [
    [
      'inherited id',
      (value: Record<string, unknown>) => {
        const inherited = Object.assign(Object.create({ id: value.id }), value)
        Reflect.deleteProperty(inherited, 'id')
        return inherited
      },
    ],
    ['array with own id', (value: Record<string, unknown>) => Object.assign([], value)],
    ['Date with own id', (value: Record<string, unknown>) => Object.assign(new Date(0), value)],
    [
      'custom prototype',
      (value: Record<string, unknown>) => Object.assign(Object.create({ custom: true }), value),
    ],
    [
      'callable outer toJSON',
      (value: Record<string, unknown>) => ({ ...value, toJSON: () => ({ lost: 'id' }) }),
    ],
    [
      'nonenumerable id',
      (value: Record<string, unknown>) =>
        Object.defineProperty({ ...value }, 'id', { value: value.id, enumerable: false }),
    ],
    [
      'accessor id',
      (value: Record<string, unknown>) =>
        Object.defineProperty({ ...value }, 'id', { get: () => value.id, enumerable: true }),
    ],
    [
      'accessor outer toJSON',
      (value: Record<string, unknown>) =>
        Object.defineProperty({ ...value }, 'toJSON', {
          get: () => () => ({ lost: 'id' }),
          enumerable: true,
        }),
    ],
  ]
  for (const [name, make] of cases) {
    const entry = { id: 'saved occurrence', output: { exact: literal } }
    await expect(
      writeFunctionalPayload(scope, { ...payload, blocks: [make(entry)] }),
      name
    ).rejects.toThrow('functional block occurrence')
    expect(mocks.memory, name).not.toHaveBeenCalled()
    expect(mocks.store, name).not.toHaveBeenCalled()
    expect(mocks.getThread, name).not.toHaveBeenCalled()
    expect(mocks.createThread, name).not.toHaveBeenCalled()
    expect(mocks.saveMessages, name).not.toHaveBeenCalled()
  }
})
it.each(['plain', 'null'])(
  'keeps a %s-prototype occurrence raw ID and nested toJSON business fields through native readback',
  async (kind) => {
    const id = '  exact opaque native id🔥  '
    const output = {
      toJSON: 'schema-owned',
      nested: { toJSON: { literal: true }, id: 'business id' },
    }
    const entry = Object.assign(Object.create(kind === 'null' ? null : Object.prototype), {
      id,
      output,
    })
    const ref = await writeFunctionalPayload(scope, { ...payload, blocks: [entry] })
    const restored = await readFunctionalPayload(ref, tx)
    expect(restored.blocks).toEqual([{ id, output }])
    expect(mocks.saveMessages).toHaveBeenCalledOnce()
  }
)
