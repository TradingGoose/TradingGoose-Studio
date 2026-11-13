/** @vitest-environment node */
import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore, type MastraCompositeStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COPILOT_CONTEXT_PART,
  type CopilotEvent,
  type CopilotRequest,
  type CopilotResponse,
  type CopilotThreadEvent,
  type Scope,
} from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { assertAcceptedServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import { readSseData } from '@/lib/events/stream'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import * as runtime from '@/lib/mastra/runtime'
import { createCopilotAgent } from './agent'
import { readCopilotRun } from './context'
import { executeCopilotCommand } from './service'
import * as runState from './state'
import { claimCopilotThread, isCopilotRunCancelled, readCopilotThreadRun } from './state'

const m = vi.hoisted(() => ({
  storage: undefined as unknown as MastraCompositeStore,
  memory: undefined as unknown as Memory,
  agent: undefined as unknown as ReturnType<typeof createCopilotAgent>,
  model: undefined as unknown as MastraLanguageModelV2Mock,
  contacts: [] as unknown[],
  access: vi.fn(),
  fetch: vi.fn(),
  admit: vi.fn(),
  accept: vi.fn(),
  route: vi.fn(),
  business: vi.fn(),
  resolve: vi.fn(),
  contexts: vi.fn(),
  credential: vi.fn(),
  cancelInsert: vi.fn(),
  receipts: new Map<string, { id: string; identifier: string; value: string }>(),
}))
vi.mock('@/lib/mastra/runtime', () => ({
  getMastra: async () => undefined,
  getCopilotAgent: async () => m.agent,
  getAgentMemory: async () => m.memory,
  getNativeMemoryStore: async () => m.storage.getStore('memory'),
  getNativeWorkflowsStore: async () => m.storage.getStore('workflows'),
}))
vi.mock('@/lib/mastra/connections', () => ({
  createConfiguredLanguageModel: vi.fn((_model: string, apiKey?: string) =>
    Object.assign(m.model, { config: { apiKey } })
  ),
  getConfiguredProviders: () => ({}),
}))
vi.mock('@/lib/copilot/settings.server', () => ({ resolveCopilotModel: m.resolve }))
vi.mock('@/lib/copilot/process-contents', () => ({ processContextsServer: m.contexts }))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => m.access(...args),
}))
vi.mock('@/lib/billing/model-usage', () => ({
  beginWorkflowModelUsage: async () => false,
  assertModelUsageAllowed: (...args: unknown[]) => m.admit(...args),
  recordModelUsage: (...args: unknown[]) => m.accept(...args),
}))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: (...args: unknown[]) => m.business(...args),
  authorizeNativeCredential: (...args: unknown[]) => m.credential(...args),
}))
vi.mock('@/lib/copilot/tools/server/workflow/check-deployment-status', () => ({
  checkDeploymentStatusServerTool: { execute: vi.fn() },
}))
vi.mock('@/lib/copilot/tools/server/router', () => ({
  routeExecution: (...args: unknown[]) => m.route(...args),
  isWorkspaceAgnosticServerTool: () => false,
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (matches: (row: unknown) => boolean) => ({
          limit: async () => [...m.receipts.values()].filter(matches).slice(0, 1),
        }),
      }),
    }),
    insert: () => ({
      values: (row: { id: string; identifier: string; value: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (row.id.startsWith('copilot:cancel:')) await m.cancelInsert()
            if (m.receipts.has(row.id)) return []
            m.receipts.set(row.id, row)
            return [{ id: row.id }]
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (matches: (row: unknown) => boolean) => ({
          returning: async () => {
            const rows = [...m.receipts.values()].filter(matches)
            for (const row of rows) Object.assign(row, patch)
            return rows.map(({ id }) => ({ id }))
          },
        }),
      }),
    }),
    delete: () => ({
      where: async (matches: (row: unknown) => boolean) => {
        for (const [id, row] of m.receipts) if (matches(row)) m.receipts.delete(id)
      },
    }),
  },
}))
vi.mock('drizzle-orm', async (original) => ({
  ...(await original<object>()),
  eq: (field: { name: string }, value: unknown) => (row: Record<string, unknown>) =>
    row[field.name] === value,
  ne: (field: { name: string }, value: unknown) => (row: Record<string, unknown>) =>
    row[field.name] !== value,
  and:
    (...conditions: Array<(row: unknown) => boolean>) =>
    (row: unknown) =>
      conditions.every((matches) => matches(row)),
}))

const scope: Scope = { actorUserId: 'actor', workspaceId: 'workspace' }
const threadClaims = () => [...m.receipts.values()].filter((row) => row.id === row.identifier)
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function restart() {
  m.memory = new Memory({
    storage: m.storage,
    options: {
      messageHistory: { maxTokens: 32000 },
      generateTitle: false,
      semanticRecall: false,
      workingMemory: { enabled: false },
      observationalMemory: false,
    },
  })
  m.agent = createCopilotAgent(m.memory)
  new Mastra({
    agents: { copilot: m.agent },
    storage: m.storage,
    recovery: { workflows: 'off', durableAgents: 'off' },
  })
}

type ResponseStep =
  | { text: string | AsyncIterable<string> }
  | { tool: string; args: Record<string, unknown>; toolCallId?: string; text?: string }
function setModel(...steps: ResponseStep[]) {
  let index = 0
  m.model = new MastraLanguageModelV2Mock({
    doStream: async (request) => {
      m.contacts.push(request)
      const step = steps[index++] ?? { text: 'Done' }
      return {
        stream: new ReadableStream({
          async start(controller) {
            if ('text' in step && step.text !== undefined) {
              controller.enqueue({ type: 'text-start', id: 'answer' })
              for await (const delta of typeof step.text === 'string' ? [step.text] : step.text)
                controller.enqueue({ type: 'text-delta', id: 'answer', delta })
              controller.enqueue({ type: 'text-end', id: 'answer' })
            }
            if ('tool' in step)
              controller.enqueue({
                type: 'tool-call',
                toolCallId: step.toolCallId ?? 'original-tool-call',
                toolName: step.tool,
                input: JSON.stringify(step.args),
              })
            controller.enqueue({
              type: 'finish',
              finishReason: 'tool' in step ? 'tool-calls' : 'stop',
              usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
            })
            controller.close()
          },
        }),
      }
    },
  })
}

function expectWorkspaceScope(request: unknown, workspaceId: string | null) {
  expect(request).toMatchObject({
    prompt: expect.arrayContaining([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining(JSON.stringify({ workspaceId })),
      }),
    ]),
  })
}

async function* readEvents<T = CopilotEvent>(stream: ReadableStream<Uint8Array>) {
  for await (const data of readSseData(stream)) yield JSON.parse(data) as T
}
async function command(input: Record<string, unknown>) {
  const selected = (input.scope ?? scope) as Scope
  const { scope: _scope, ...fields } = input
  const response = await executeCopilotCommand(
    { workspaceId: selected.workspaceId, ...fields } as CopilotRequest,
    selected.actorUserId
  )
  let body: CopilotResponse | undefined
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    for await (const event of readEvents(response.body!))
      if ('result' in event && event.type !== 'tool.result') body = event.result as CopilotResponse
  } else body = (await response.json()) as CopilotResponse
  return { response, result: body! }
}
async function message(extra: Record<string, unknown> = {}) {
  return command({
    command: 'message',
    model: 'configured/model',
    input: { content: 'Original request🔥' },
    ...extra,
  })
}
function suspended(result: CopilotResponse) {
  expect(result.status).toBe('suspended')
  if (result.status !== 'suspended') throw new Error(JSON.stringify(result))
  return result
}
async function pending(threadId: string) {
  const { result } = await command({
    command: 'history.read',
    threadId,
  })
  expect(result.status).toBe('history')
  if (result.status !== 'history') throw new Error(JSON.stringify(result))
  return result.pending
}

beforeEach(() => {
  vi.clearAllMocks()
  m.route.mockReset()
  m.resolve.mockReset().mockImplementation(async (model: string) => ({
    model,
    apiKey: 'admin-key',
  }))
  m.contacts.length = 0
  m.receipts.clear()
  m.access.mockResolvedValue({ hasAccess: true })
  m.fetch.mockRejectedValue(new Error('External Copilot is unavailable'))
  vi.stubGlobal('fetch', m.fetch)
  m.admit.mockResolvedValue(undefined)
  m.accept.mockImplementation(async (_scope, _usage, cost) => cost)
  m.business.mockResolvedValue(undefined)
  m.contexts.mockReset().mockResolvedValue([])
  m.credential.mockReset()
  m.cancelInsert.mockReset().mockResolvedValue(undefined)
  m.storage = new InMemoryStore()
  restart()
})
afterEach(() => vi.unstubAllGlobals())

describe('built-in Copilot service bridge', () => {
  it('still cancels preflight when Stop occurs before a run ID is delivered', async () => {
    setModel({ text: 'Must not run' })
    const preparing = deferred()
    const release = deferred()
    m.resolve.mockImplementationOnce(async () => {
      preparing.resolve()
      await release.promise
      return { model: 'configured/model', apiKey: 'admin-key' }
    })
    const request = new AbortController()
    const settled = vi.spyOn(runState, 'releaseCopilotThread')
    try {
      const response = await executeCopilotCommand(
        {
          command: 'message',
          workspaceId: scope.workspaceId,
          model: 'configured/model',
          input: { content: 'Stop before acceptance' },
        },
        scope.actorUserId,
        request.signal
      )
      await preparing.promise
      request.abort()
      await response.body!.cancel()
      release.resolve()
      await vi.waitFor(() => expect(settled).toHaveBeenCalled())
      expect(m.contacts).toHaveLength(0)
      expect(m.accept).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      settled.mockRestore()
    }
  })

  it('reconnects to a detached live response and saves its answer without another model call', async () => {
    const threadId = crypto.randomUUID()
    await m.memory.createThread({
      threadId,
      resourceId: nativeConversationIdentity(scope).resourceId,
    })
    const finish = deferred()
    setModel({
      text: (async function* () {
        yield 'First '
        await finish.promise
        yield 'answer'
      })(),
    })
    const request = new AbortController()
    const response = await executeCopilotCommand(
      {
        command: 'message',
        workspaceId: scope.workspaceId,
        threadId,
        model: 'configured/model',
        input: { content: 'Keep answering after reload' },
      },
      scope.actorUserId,
      request.signal
    )
    const original = readEvents(response.body!)
    const first = (await original.next()).value!
    if (first.type !== 'response.started') throw new Error('Expected response.started')
    while ((await original.next()).value?.type !== 'text.delta') {}
    request.abort()
    await original.return(undefined)
    expect((m.contacts[0] as any).abortSignal.aborted).toBe(false)

    const observation = await executeCopilotCommand(
      { command: 'thread.observe', workspaceId: scope.workspaceId, threadId },
      scope.actorUserId
    )
    const restored = readEvents<CopilotThreadEvent>(observation.body!)
    try {
      expect((await restored.next()).value).toMatchObject({
        type: 'thread.history',
        activeRunId: first.runId,
        result: { threadId, pending: [] },
      })
      let text = ''
      while (!text.includes('First')) {
        const event = (await restored.next()).value!
        if (event.type === 'thread.output' && event.event.type === 'text.delta')
          text += event.event.text
      }
      finish.resolve()
      for await (const event of restored) {
        if (event.type === 'thread.output' && event.event.type === 'text.delta')
          text += event.event.text
        if (event.type === 'thread.status' && event.runId === first.runId) {
          expect(event.status).toBe('success')
          break
        }
      }
      expect(text).toBe('First answer')
      expect(m.contacts).toHaveLength(1)
      expect(m.admit).toHaveBeenCalledTimes(1)
      expect(m.accept).toHaveBeenCalledTimes(1)
      expect(await readCopilotThreadRun(scope, threadId)).toBeUndefined()
      const { result } = await command({ command: 'history.read', threadId })
      expect(result).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            parts: expect.arrayContaining([expect.objectContaining({ text: 'First answer' })]),
          }),
        ]),
      })
    } finally {
      finish.resolve()
      await restored.return(undefined)
    }
  })

  it('reports an unconfirmed interrupted owner without unlocking or rerunning it', async () => {
    const threadId = crypto.randomUUID()
    await m.memory.createThread({
      threadId,
      resourceId: nativeConversationIdentity(scope).resourceId,
    })
    await claimCopilotThread(scope, threadId, 'unconfirmed-run')
    const response = await executeCopilotCommand(
      { command: 'thread.observe', workspaceId: scope.workspaceId, threadId },
      scope.actorUserId
    )
    const observer = readEvents<CopilotThreadEvent>(response.body!)
    try {
      expect((await observer.next()).value).toMatchObject({
        type: 'thread.history',
        activeRunId: null,
        interruptedRunId: 'unconfirmed-run',
      })
      expect(await readCopilotThreadRun(scope, threadId)).toBe('unconfirmed-run')
      expect(m.contacts).toHaveLength(0)
      expect(m.accept).not.toHaveBeenCalled()
    } finally {
      await observer.return(undefined)
    }
  })

  it.each(['authorization', 'dispatch'])(
    'does not start generation when cancelled during %s',
    async (stage) => {
      const controller = new AbortController()
      const reason = new DOMException('Request cancelled', 'AbortError')
      setModel({ text: 'Must not run' })
      const stop = async () => {
        controller.abort(reason)
        return { hasAccess: true }
      }
      const dispatch =
        stage === 'dispatch'
          ? vi.spyOn(runtime, 'getNativeMemoryStore').mockImplementationOnce(async () => {
              controller.abort(reason)
              return (await m.storage.getStore('memory'))!
            })
          : undefined
      if (stage === 'authorization') m.access.mockImplementationOnce(stop)
      try {
        await expect(
          executeCopilotCommand(
            {
              command: 'message',
              workspaceId: scope.workspaceId,
              model: 'configured/model',
              input: { content: 'Do not generate after cancellation' },
            },
            scope.actorUserId,
            controller.signal
          )
        ).rejects.toBe(reason)
        expect(m.contacts).toEqual([])
        expect(m.admit).not.toHaveBeenCalled()
        expect(m.accept).not.toHaveBeenCalled()
        expect(threadClaims()).toHaveLength(0)
      } finally {
        dispatch?.mockRestore()
      }
    }
  )
  it.each([409, 422])(
    'refuses unavailable admin configuration (%i) before claiming a thread or inference',
    async (status) => {
      m.resolve.mockRejectedValueOnce(new NativeTargetError('Copilot model unavailable', status))
      setModel({ text: 'Must not run' })
      expect((await message()).result).toMatchObject({ status: 'refused' })
      expect(m.contacts).toHaveLength(0)
      expect(threadClaims()).toHaveLength(0)
      expect(m.admit).not.toHaveBeenCalled()
      expect(createConfiguredLanguageModel).not.toHaveBeenCalled()
    }
  )
  it('rejects the next message after key removal even when the shared Agent is already warm', async () => {
    setModel({ text: 'Finished before key removal' }, { text: 'Must not run' })
    const initial = (await message()).result
    if (initial.status !== 'completed') throw new Error(JSON.stringify(initial))
    const agent = m.agent
    const history = (await command({ command: 'history.read', threadId: initial.threadId })).result
    const admissions = m.admit.mock.calls.length
    const charges = m.accept.mock.calls.length
    const models = vi.mocked(createConfiguredLanguageModel).mock.calls.length
    m.resolve.mockRejectedValue(new NativeTargetError('The Copilot API key is not configured', 409))

    expect((await message({ threadId: initial.threadId })).result).toMatchObject({
      status: 'refused',
      error: { code: 'STALE_TARGET', message: 'The Copilot API key is not configured' },
    })
    expect(m.agent).toBe(agent)
    expect(m.resolve).toHaveBeenCalledTimes(2)
    expect(m.contacts).toHaveLength(1)
    expect(createConfiguredLanguageModel).toHaveBeenCalledTimes(models)
    expect(m.admit).toHaveBeenCalledTimes(admissions)
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(m.route).not.toHaveBeenCalled()
    expect(m.receipts.size).toBe(0)
    expect(threadClaims()).toHaveLength(0)
    expect((await command({ command: 'history.read', threadId: initial.threadId })).result).toEqual(
      history
    )
  })
  it('returns complete scoped native lists in their stored order', async () => {
    const store = (await m.storage.getStore('memory'))!
    const resourceId = nativeConversationIdentity(scope).resourceId
    for (let i = 0; i < 125; i++)
      await store.saveThread({
        thread: {
          id: `thread-${i}`,
          resourceId,
          title: '',
          createdAt: new Date(i * 1000),
          updatedAt: new Date(i * 1000),
        },
      })
    await store.saveThread({
      thread: {
        id: 'foreign',
        resourceId: 'another-resource',
        title: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
    const threads = (await command({ command: 'threads.list' })).result
    if (threads.status !== 'threads') throw new Error(JSON.stringify(threads))
    expect(threads.items.map((thread) => thread.id)).toEqual(
      Array.from({ length: 125 }, (_, i) => `thread-${124 - i}`)
    )
    await store.saveMessages({
      messages: Array.from({ length: 125 }, (_, i) => ({
        id: `message-${i}`,
        threadId: 'thread-0',
        resourceId,
        role: 'user' as const,
        createdAt: new Date(i * 1000),
        content: { format: 2 as const, parts: [{ type: 'text' as const, text: `Message ${i}` }] },
      })),
    })
    const history = (await command({ command: 'history.read', threadId: 'thread-0' })).result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    expect(history.items.map((message) => message.id)).toEqual(
      Array.from({ length: 125 }, (_, i) => `message-${i}`)
    )
  })
  it('completes chat, native image history, and a later turn with the external service unavailable', async () => {
    setModel({ text: 'Known answer🔥' }, { text: 'Follow-up answer' })
    const { result } = await message({
      input: {
        content: [
          { type: 'text', text: 'Original request🔥' },
          {
            type: 'image',
            image: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=',
            mediaType: 'image/png',
          },
        ],
      },
    })
    expect(result).toMatchObject({
      status: 'completed',
      text: 'Known answer🔥',
    })
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    restart()
    const history = (
      await command({
        command: 'history.read',
        threadId: result.threadId,
      })
    ).result
    expect(history.status).toBe('history')
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    expect(history.items[0].parts).toContainEqual(
      expect.objectContaining({
        type: 'file',
        data: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=',
        mimeType: 'image/png',
      })
    )
    expect(JSON.stringify(history.items)).toContain('Known answer🔥')
    const next = (await message({ threadId: result.threadId, input: { content: 'Follow up' } }))
      .result
    expect(next).toMatchObject({ status: 'completed', text: 'Follow-up answer' })
    expect(JSON.stringify(m.contacts[1])).toContain('Original request🔥')
    expect(m.accept).toHaveBeenCalledTimes(2)
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it('executes a server read and continues generation within one local command', async () => {
    const workspaceId = '550e8400-e29b-41d4-a716-446655440000'
    setModel({ tool: 'list_workflows', args: { workspaceId } }, { text: 'One known workflow' })
    m.route.mockResolvedValueOnce({
      entityKind: 'workflow',
      entities: [{ entityId: 'workflow', entityName: 'Known' }],
      count: 1,
    })
    const { result } = await message({ scope: { ...scope, workspaceId }, accessLevel: 'full' })
    expectWorkspaceScope(m.contacts[0], workspaceId)
    expect(result).toMatchObject({
      status: 'completed',
      text: 'One known workflow',
    })
    expect(m.route).toHaveBeenCalledExactlyOnceWith(
      'list_workflows',
      { workspaceId },
      expect.objectContaining({ userId: 'actor', workspaceId })
    )
    expect(m.admit).toHaveBeenCalledTimes(2)
    expect(m.accept).toHaveBeenCalledTimes(2)
    expect(createConfiguredLanguageModel).toHaveBeenCalledExactlyOnceWith(
      'configured/model',
      'admin-key'
    )
    expect(m.fetch).not.toHaveBeenCalled()
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    const history = (
      await command({
        scope: { ...scope, workspaceId },
        command: 'history.read',
        threadId: result.threadId,
      })
    ).result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    expect(history.items.filter((item) => item.role === 'assistant')).toMatchObject([
      {
        usage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 },
        cost: { status: 'unavailable' },
      },
    ])
  })

  it('identifies a personal conversation without inventing a selected workspace', async () => {
    setModel({ text: 'Select a workspace to list its workflows.' })
    const { result } = await message({ scope: { ...scope, workspaceId: null } })
    expect(result.status).toBe('completed')
    expectWorkspaceScope(m.contacts[0], null)
    expect(JSON.stringify(m.contacts[0])).toContain('select a workspace')
    expect(m.route).not.toHaveBeenCalled()
  })

  it('fails an exhausted native tool loop while retaining every step charge and releasing the conversation', async () => {
    setModel(
      ...Array.from({ length: 50 }, (_, index) => ({
        tool: 'list_workflows',
        args: { workspaceId: 'workspace' },
        toolCallId: `loop-call-${index}`,
      }))
    )
    m.route.mockResolvedValue({ entityKind: 'workflow', entities: [], count: 0 })
    const { result } = await message({ accessLevel: 'full' })
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'GENERATION_FAILED' },
      usage: { inputTokens: 150, outputTokens: 100, totalTokens: 250 },
    })
    expect(m.contacts).toHaveLength(50)
    expect(m.route).toHaveBeenCalledTimes(49)
    expect(m.accept).toHaveBeenCalledTimes(50)
    expect(threadClaims()).toHaveLength(0)
  })

  it('reserves the last native step for an answer using existing tool results', async () => {
    setModel(
      ...Array.from({ length: 49 }, (_, index) => ({
        tool: 'list_workflows',
        args: { workspaceId: 'workspace' },
        toolCallId: `answer-call-${index}`,
      })),
      { text: 'No workflows are available.' }
    )
    m.route.mockResolvedValue({ entityKind: 'workflow', entities: [], count: 0 })
    const { result } = await message({ accessLevel: 'full' })
    expect(result).toMatchObject({
      status: 'completed',
      text: 'No workflows are available.',
      usage: { inputTokens: 150, outputTokens: 100, totalTokens: 250 },
    })
    expect(m.contacts).toHaveLength(50)
    expect(m.contacts.at(-1)).toMatchObject({ toolChoice: { type: 'none' } })
    expect(m.route).toHaveBeenCalledTimes(49)
    expect(m.accept).toHaveBeenCalledTimes(50)
    expect(threadClaims()).toHaveLength(0)
  })

  it('does not accept earlier tool commentary as an answer when the final response is blank', async () => {
    setModel(
      { tool: 'list_workflows', args: { workspaceId: 'workspace' }, text: 'Checking workflows...' },
      { text: '' }
    )
    m.route.mockResolvedValue({ entityKind: 'workflow', entities: [], count: 0 })
    const { result } = await message({ accessLevel: 'full' })
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'GENERATION_FAILED' },
      usage: { inputTokens: 6, outputTokens: 4, totalTokens: 10 },
    })
    expect(m.accept).toHaveBeenCalledTimes(2)
    expect(threadClaims()).toHaveLength(0)
  })

  it('gives the model current Studio context while persisting and editing only the visible input', async () => {
    setModel(
      { text: 'Initial answer' },
      { text: 'Replacement answer' },
      { text: 'Follow-up answer' }
    )
    const context = {
      kind: 'workflow',
      workflowId: 'original-workflow-unique-id',
      label: 'My workflow',
    }
    const privateContext = 'Private current Studio context'
    m.contexts.mockResolvedValueOnce([
      { type: 'workflow', tag: '@My workflow', content: privateContext },
    ])
    const { result } = await message({
      input: { content: 'Explain @My workflow', contexts: [context] },
    })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    expect(JSON.stringify(m.contacts[0])).toContain(privateContext)
    expect(JSON.stringify(m.contacts[0])).toContain('Explain @My workflow')
    const history = (
      await command({
        command: 'history.read',
        threadId: result.threadId,
      })
    ).result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    expect(history.items[0].parts).toMatchObject([
      { type: 'text', text: 'Explain @My workflow' },
      { type: COPILOT_CONTEXT_PART, data: [context] },
    ])
    expect(JSON.stringify(history)).not.toContain(privateContext)
    expect(JSON.stringify(history)).not.toContain('workspaceId')
    expect(
      (
        await command({
          command: 'message',
          model: 'configured/model',
          threadId: result.threadId,
          messageId: history.items[0].id,
          input: { content: 'Edited @My workflow', contexts: [context] },
        })
      ).result.status
    ).toBe('completed')
    expect(JSON.stringify(m.contacts[1])).toContain('Edited @My workflow')
    expect(JSON.stringify(m.contacts[1])).not.toContain('Initial answer')
    const edited = (await command({ command: 'history.read', threadId: result.threadId })).result
    if (edited.status !== 'history') throw new Error(JSON.stringify(edited))
    expect(edited.items).toHaveLength(2)
    expect(edited.items[0]).toMatchObject({
      id: history.items[0].id,
      parts: [
        { type: 'text', text: 'Edited @My workflow' },
        { type: COPILOT_CONTEXT_PART, data: [context] },
      ],
    })
    expect(edited.items[1].parts).toMatchObject([{ type: 'text', text: 'Replacement answer' }])
    restart()
    expect(
      (await message({ threadId: result.threadId, input: { content: 'Follow up' } })).result.status
    ).toBe('completed')
    expect(JSON.stringify(m.contacts[2])).toContain('Edited @My workflow')
    expect(JSON.stringify(m.contacts[2])).toContain(context.workflowId)
    expect(JSON.stringify(m.contacts[2])).not.toContain(privateContext)
  })

  it('streams validated Studio events through server-tool continuation', async () => {
    setModel(
      { tool: 'list_workflows', args: { workspaceId: 'workspace' } },
      { text: 'Known workflows' }
    )
    m.route.mockResolvedValueOnce({ entityKind: 'workflow', entities: [], count: 0 })
    const response = await executeCopilotCommand(
      {
        workspaceId: scope.workspaceId,
        command: 'message',
        model: 'configured/model',
        input: { content: 'Do not expose this prompt in raw transport' },
        accessLevel: 'full',
      },
      scope.actorUserId
    )
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const events = []
    for await (const event of readEvents(response.body!)) events.push(event)
    expect(events[0]).toMatchObject({
      type: 'response.started',
      messageId: expect.any(String),
    })
    expect(events.map((event) => event.type)).toEqual([
      'response.started',
      'tool.display',
      'tool.result',
      'text.delta',
      'response.completed',
    ])
    expect(events[2]).toMatchObject({
      type: 'tool.result',
      toolName: 'list_workflows',
      result: { entityKind: 'workflow', entities: [], count: 0 },
    })
    expect(events[4]).toMatchObject({
      type: 'response.completed',
      result: { status: 'completed', text: 'Known workflows' },
    })
    expect(JSON.stringify(events)).not.toContain('Do not expose this prompt in raw transport')
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it.each([undefined, 'drive-workspace'])(
    'keeps the authorized Drive workspace in a personal conversation continuation (selection: %s)',
    async (selectedWorkspace) => {
      const personal = { ...scope, workspaceId: null }
      const workspaceId = 'drive-workspace'
      const credentialId = 'drive-credential'
      m.credential.mockResolvedValue({ credentialId, workspaceId, providerId: 'google-drive' })
      setModel(
        { tool: 'gdrive_request_access', args: {} },
        { tool: 'list_gdrive_files', args: { workspaceId, credentialId } },
        { text: 'Drive files are available' }
      )
      m.route.mockResolvedValue({ files: [] })
      const initial = suspended((await message({ scope: personal, accessLevel: 'full' })).result)
      expect(initial.pending[0]).toMatchObject({
        stage: 'result',
        target: { toolName: 'gdrive_request_access' },
      })
      restart()
      const { result } = await command({
        scope: personal,
        command: 'tool.execute',
        target: initial.pending[0].target,
        action: 'readback',
        ...(selectedWorkspace ? { context: { workspaceId: selectedWorkspace } } : {}),
        readback: { credentialId },
      })
      expect(result).toMatchObject({ status: 'completed', text: 'Drive files are available' })
      expect(m.credential).toHaveBeenCalledWith(personal, credentialId, selectedWorkspace)
      expect(JSON.stringify(m.contacts[1])).toContain(credentialId)
      expect(JSON.stringify(m.contacts[1])).toContain(workspaceId)
      expect(m.route).toHaveBeenCalledWith(
        'list_gdrive_files',
        expect.objectContaining({ workspaceId, credentialId }),
        expect.objectContaining({ workspaceId, userId: scope.actorUserId })
      )
      expect(m.admit.mock.calls.every(([usageScope]) => usageScope.workspaceId === undefined)).toBe(
        true
      )
      expect(
        m.accept.mock.calls.every(([usageScope]) => usageScope.workspaceId === undefined)
      ).toBe(true)
      const memory = await m.storage.getStore('memory')
      expect((await memory!.getThreadById({ threadId: initial.threadId }))?.resourceId).toBe(
        nativeConversationIdentity(personal).resourceId
      )
    }
  )

  it.each(['missing', 'assistant', 'image', 'context', 'tool-history'])(
    'refuses an unsafe edited submission without changing native history (%s)',
    async (kind) => {
      setModel(
        ...(kind === 'tool-history'
          ? [{ tool: 'list_workflows', args: { workspaceId: 'workspace' } }]
          : []),
        { text: 'Original answer' }
      )
      m.route.mockResolvedValue({ entityKind: 'workflow', entities: [], count: 0 })
      const initial = (await message({ accessLevel: 'full' })).result
      if (initial.status !== 'completed') throw new Error(JSON.stringify(initial))
      const store = (await m.storage.getStore('memory'))!
      const lookup = {
        threadId: initial.threadId,
        resourceId: nativeConversationIdentity(scope).resourceId,
        perPage: false as const,
        orderBy: { field: 'createdAt' as const, direction: 'ASC' as const },
      }
      const stored = await store.listMessages(lookup)
      if (kind === 'image')
        await store.saveMessages({
          messages: [
            {
              ...stored.messages[0],
              content: {
                format: 2,
                parts: [
                  { type: 'file', data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' },
                ],
              },
            },
          ],
        })
      const before = await store.listMessages(lookup)
      const contacts = m.contacts.length
      const charges = m.accept.mock.calls.length
      expect(
        (
          await message({
            threadId: initial.threadId,
            messageId:
              kind === 'missing'
                ? 'foreign-message'
                : kind === 'assistant'
                  ? stored.messages.at(-1)!.id
                  : stored.messages[0].id,
            input: {
              content: 'Edited',
              ...(kind === 'context' ? { contexts: [{ kind: 'docs', label: 'New context' }] } : {}),
            },
          })
        ).result.status
      ).toBe('refused')
      expect(await store.listMessages(lookup)).toEqual(before)
      expect(m.contacts).toHaveLength(contacts)
      expect(m.accept).toHaveBeenCalledTimes(charges)
      expect(threadClaims()).toHaveLength(0)
    }
  )

  it('recovers the original preview after restart and applies a decision once', async () => {
    const originalCredential = 'first-synthetic-credential'
    const rotatedCredential = 'replacement-synthetic-credential'
    m.resolve.mockImplementation(async (model: string) => ({
      model,
      apiKey: originalCredential,
    }))
    const args = { entityId: 'workflow', name: 'Renamed' }
    const preview = { requiresReview: true, reviewBaseStateHash: 'original-base' }
    setModel({ tool: 'rename_workflow', args }, { text: 'Renamed successfully' })
    m.route.mockResolvedValueOnce(preview).mockResolvedValueOnce({
      success: true,
      workspaceId: 'workspace',
      entityKind: 'workflow',
      entityId: 'workflow',
      entityName: 'Renamed',
    })
    const context = { kind: 'workflow', workflowId: 'workflow', label: 'Current workflow' }
    const privateContext = 'Current rename context'
    m.contexts.mockResolvedValueOnce([
      { type: 'workflow', tag: '@Current workflow', content: privateContext },
    ])
    const initial = suspended(
      (
        await message({
          accessLevel: 'limited',
          model: 'openai/gpt-4.1',
          input: { content: 'Rename the workflow', contexts: [context] },
        })
      ).result
    )
    expect(initial.pending[0].stage).toBe('approval')
    expect(m.route).not.toHaveBeenCalled()
    const workflows = (await m.storage.getStore('workflows'))!
    expect(JSON.stringify(m.model).includes(originalCredential)).toBe(true)
    expect(
      JSON.stringify(await workflows.getWorkflowRunById({ runId: initial.runId }))
    ).not.toContain('copilot-execution')
    expect(
      JSON.stringify(await workflows.getWorkflowRunById({ runId: initial.runId })).includes(
        originalCredential
      )
    ).toBe(false)
    m.resolve.mockImplementation(async (model: string) => ({ model, apiKey: rotatedCredential }))
    restart()
    expect(await readCopilotRun(scope, initial.threadId, initial.runId)).toMatchObject({
      scope,
      model: 'openai/gpt-4.1',
      accessLevel: 'limited',
    })
    await expect(
      readCopilotRun({ ...scope, actorUserId: 'foreign' }, initial.threadId, initial.runId)
    ).rejects.toMatchObject({ status: 403 })
    await expect(readCopilotRun(scope, 'another-thread', initial.runId)).rejects.toMatchObject({
      status: 403,
    })
    const approved = suspended(
      (await command({ command: 'tool.approve', target: initial.pending[0].target })).result
    )
    expect(m.resolve).toHaveBeenLastCalledWith('openai/gpt-4.1')
    expect(createConfiguredLanguageModel).toHaveBeenLastCalledWith(
      'openai/gpt-4.1',
      rotatedCredential
    )
    expect(JSON.stringify(m.model).includes(rotatedCredential)).toBe(true)
    const resumedSnapshot = JSON.stringify(
      await workflows.getWorkflowRunById({ runId: initial.runId })
    )
    expect(
      [originalCredential, rotatedCredential].some((credential) =>
        resumedSnapshot.includes(credential)
      )
    ).toBe(false)
    expect(approved.pending[0]).toMatchObject({
      stage: 'result',
      originalArgs: args,
      preview: { requiresReview: true },
    })
    expect(approved.pending[0]).not.toHaveProperty('reviewBaseStateHash')
    expect(approved.pending[0].context).toEqual({
      contextEntityKind: 'workflow',
      contextEntityId: 'workflow',
    })
    expect(approved.pending[0].preview).not.toHaveProperty('reviewBaseStateHash')
    expect(approved.pending[0].preview).not.toHaveProperty('reviewToken')
    expect(m.route).toHaveBeenCalledOnce()
    restart()
    expect(
      (
        await command({
          command: 'tool.execute',
          target: approved.pending[0].target,
          action: 'review.accept',
          context: { contextEntityKind: 'workflow', contextEntityId: 'another-workflow' },
        })
      ).result
    ).toMatchObject({ status: 'refused', error: { code: 'FORBIDDEN' } })
    expect(m.route).toHaveBeenCalledOnce()
    const decision = {
      command: 'tool.execute',
      target: approved.pending[0].target,
      action: 'review.accept',
    }
    expect((await command(decision)).result).toMatchObject({
      status: 'completed',
      text: 'Renamed successfully',
    })
    expect(m.route).toHaveBeenCalledTimes(2)
    expectWorkspaceScope(m.contacts[1], scope.workspaceId)
    expect(JSON.stringify(m.contacts[1])).toContain(privateContext)
    expect(m.route).toHaveBeenLastCalledWith(
      'rename_workflow',
      args,
      expect.objectContaining({ accessLevel: 'full', acceptedReviewBaseStateHash: 'original-base' })
    )
    const history = (await command({ command: 'history.read', threadId: initial.threadId })).result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    const assistants = history.items.filter((item) => item.role === 'assistant')
    expect(assistants).toHaveLength(2)
    for (const assistant of assistants) {
      expect(assistant.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 })
      expect(assistant.cost).toMatchObject({ status: 'estimated', currency: 'USD' })
      expect(assistant.cost?.total).toBeCloseTo(0.000022, 12)
    }
    const contacts = m.contacts.length
    expect((await command(decision)).result).toMatchObject({
      status: 'refused',
      error: { code: 'STALE_TARGET' },
    })
    expect(m.route).toHaveBeenCalledTimes(2)
    expect(m.contacts).toHaveLength(contacts)
  })

  it.each([undefined, { contextEntityKind: 'workflow' as const, contextEntityId: 'workflow-B' }])(
    'restores pending context from its native run and keeps it on new browser tools (%j)',
    async (toolContext) => {
      setModel(
        { tool: 'make_api_request', args: { url: 'https://example.com', method: 'GET' } },
        { tool: 'sleep', args: { seconds: 1 } },
        { text: 'Done' }
      )
      m.route.mockResolvedValueOnce({ status: 200, data: 'Read' })
      const initial = suspended((await message({ toolContext, accessLevel: 'limited' })).result)
      const expected = toolContext ?? { workspaceId: scope.workspaceId }
      expect(initial.pending[0]).toMatchObject({ stage: 'approval', context: expected })
      restart()
      expect(await pending(initial.threadId)).toEqual(initial.pending)
      const resumed = suspended(
        (await command({ command: 'tool.approve', target: initial.pending[0].target })).result
      )
      expect(resumed.pending).toHaveLength(1)
      expect(resumed.pending[0]).toMatchObject({
        target: { threadId: initial.threadId, runId: initial.runId, toolName: 'sleep' },
        stage: 'result',
        context: expected,
      })
      restart()
      expect(await pending(initial.threadId)).toEqual(resumed.pending)
      expect(
        (
          await command({
            command: 'tool.result',
            target: resumed.pending[0].target,
            assertion: { kind: 'timer.completed', data: { success: true, seconds: 1 } },
          })
        ).result
      ).toMatchObject({ status: 'completed', text: 'Done' })
    }
  )

  it.each(['reject', 'stale'] as const)(
    'keeps native preview %s decisions from applying a mutation',
    async (decision) => {
      const args = { entityId: 'workflow', name: 'Renamed' }
      const preview = { requiresReview: true, reviewBaseStateHash: 'original-base' }
      setModel({ tool: 'rename_workflow', args }, { text: 'No edit applied' })
      m.route.mockResolvedValueOnce(preview)
      m.route.mockImplementationOnce(async (_name, _args, context) => {
        assertAcceptedServerToolReviewBase(context, 'changed-base')
        throw new Error('A stale edit must not reach its write')
      })
      const initial = suspended((await message({ accessLevel: 'limited' })).result)
      const approved = suspended(
        (
          await command({
            command: 'tool.approve',
            target: initial.pending[0].target,
          })
        ).result
      )
      restart()
      const result = await command({
        command: 'tool.execute',
        target: approved.pending[0].target,
        action: decision === 'reject' ? 'review.reject' : 'review.accept',
      })
      expect(result.result).toMatchObject({ status: 'completed', text: 'No edit applied' })
      expect(m.route).toHaveBeenCalledTimes(decision === 'reject' ? 1 : 2)
      if (decision === 'stale')
        expect(m.route).toHaveBeenLastCalledWith(
          'rename_workflow',
          args,
          expect.objectContaining({
            accessLevel: 'full',
            acceptedReviewBaseStateHash: 'original-base',
          })
        )
      expect(await pending(initial.threadId)).toEqual([])
      const history = (
        await command({
          command: 'history.read',
          threadId: initial.threadId,
        })
      ).result
      expect(JSON.stringify(history)).toContain(decision === 'reject' ? 'rejected' : 'stale')
    }
  )

  it('rejects a foreign thread and revoked membership before any model admission', async () => {
    const foreignScope = { actorUserId: 'foreign-actor', workspaceId: 'workspace' }
    await m.memory.createThread({
      threadId: 'foreign-thread',
      resourceId: nativeConversationIdentity(foreignScope).resourceId,
      title: '',
      metadata: { product: 'copilot' },
    })
    setModel({ text: 'Must never contact' })
    expect((await message({ threadId: 'foreign-thread' })).result).toMatchObject({
      status: 'refused',
    })
    expect(m.admit).not.toHaveBeenCalled()
    m.access.mockResolvedValueOnce({ hasAccess: false })
    await expect(message()).rejects.toMatchObject({ status: 403 })
    expect(m.contacts).toHaveLength(0)
  })

  it('durably cancels pending work so another instance cannot resume generation or effects', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Renamed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const original = initial.pending[0]
    const charges = m.accept.mock.calls.length
    expect(
      (await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId }))
        .result
    ).toMatchObject({ status: 'cancel_requested' })
    restart()
    expect(await pending(initial.threadId)).toEqual([])
    expect(
      (await command({ command: 'tool.approve', target: original.target })).result
    ).toMatchObject({ status: 'refused' })
    expect(m.route).not.toHaveBeenCalled()
    expect(m.contacts).toHaveLength(1)
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(threadClaims()).toHaveLength(0)
  })
  it.each(['approval', 'review'])(
    'retains a resumed %s writer until its approved effect settles despite cancellation',
    async (stage) => {
      setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
      let initial = suspended((await message({ accessLevel: 'limited' })).result)
      if (stage === 'review') {
        m.route.mockResolvedValueOnce({ requiresReview: true, reviewBaseStateHash: 'base' })
        initial = suspended(
          (await command({ command: 'tool.approve', target: initial.pending[0].target })).result
        )
      }
      const entered = deferred()
      const effect = deferred()
      const cancelling = deferred()
      const cancellation = deferred()
      m.cancelInsert.mockImplementationOnce(async () => {
        cancelling.resolve()
        await cancellation.promise
      })
      let settled = false
      let signal: AbortSignal | undefined
      m.route.mockImplementationOnce(async (_name, _args, context) => {
        signal = context.signal
        entered.resolve()
        await effect.promise
        settled = true
        return { entityId: 'workflow', entityName: 'Changed', workspaceId: scope.workspaceId }
      })
      let acknowledged = false
      const stopping = command({
        command: 'cancel',
        threadId: initial.threadId,
        runId: initial.runId,
      }).then((result) => {
        acknowledged = true
        return result
      })
      await cancelling.promise
      restart()
      const continuing = command({
        command: stage === 'approval' ? 'tool.approve' : 'tool.execute',
        target: initial.pending[0].target,
        ...(stage === 'review' ? { action: 'review.accept' } : {}),
      })
      await entered.promise
      const native = await m.agent.subscribeToThread({
        ...nativeConversationIdentity(scope),
        threadId: initial.threadId,
        withRunStatus: true,
      })
      const nativeAborted = (async () => {
        for await (const event of native.stream)
          if (event.type === 'thread-run-status' && event.payload.status === 'aborted') return
        throw new Error('Native cancellation status was not delivered')
      })()
      const observing = new AbortController()
      const observation = await executeCopilotCommand(
        { command: 'thread.observe', workspaceId: scope.workspaceId, threadId: initial.threadId },
        scope.actorUserId,
        observing.signal
      )
      let cancellationObserved = false
      const observationCompleted = (async () => {
        for await (const event of readEvents<CopilotThreadEvent>(observation.body!)) {
          if (event.type === 'thread.status' && event.status === 'aborted') {
            cancellationObserved = true
            return event
          }
        }
        throw new Error('Studio cancellation status was not delivered')
      })()
      cancellation.resolve()
      try {
        await vi.waitFor(() => expect(signal?.aborted).toBe(true))
        await nativeAborted
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(cancellationObserved).toBe(false)
        expect(settled).toBe(false)
        expect(acknowledged).toBe(false)
        expect(await readCopilotThreadRun(scope, initial.threadId)).toBe(initial.runId)
        await expect(
          claimCopilotThread(scope, initial.threadId, 'competing-run')
        ).rejects.toMatchObject({
          status: 409,
        })
      } finally {
        effect.resolve()
        try {
          await continuing
          expect((await stopping).result).toMatchObject({ status: 'cancel_requested' })
          expect(await observationCompleted).toMatchObject({
            type: 'thread.status',
            runId: initial.runId,
            status: 'aborted',
          })
        } finally {
          observing.abort()
          native.unsubscribe()
        }
      }
      expect(settled).toBe(true)
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBeUndefined()
    }
  )
  it('refuses a stale resume preflight after cancellation admits a new run', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const entered = deferred()
    const preflight = deferred()
    m.resolve.mockImplementationOnce(async () => {
      entered.resolve()
      await preflight.promise
      return { apiKey: 'admin-key' }
    })
    const continuing = command({ command: 'tool.approve', target: initial.pending[0].target })
    await entered.promise
    try {
      expect(
        (await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId }))
          .result
      ).toMatchObject({ status: 'cancel_requested' })
      await claimCopilotThread(scope, initial.threadId, 'next-run')
    } finally {
      preflight.resolve()
    }
    expect((await continuing).result).toMatchObject({ status: 'refused' })
    expect(m.route).not.toHaveBeenCalled()
    expect(await readCopilotThreadRun(scope, initial.threadId)).toBe('next-run')
  })
  it('admits only one of two continuations prepared from the same suspension', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const ready = deferred()
    const preflight = deferred()
    const effect = deferred()
    const executing = deferred()
    let prepared = 0
    m.resolve.mockImplementation(async () => {
      if (++prepared === 2) ready.resolve()
      await preflight.promise
      return { apiKey: 'admin-key' }
    })
    m.route.mockImplementationOnce(async () => {
      executing.resolve()
      await effect.promise
      return { entityId: 'workflow', entityName: 'Changed', workspaceId: scope.workspaceId }
    })
    const results: CopilotResponse[] = []
    const attempts = [0, 1].map(() =>
      command({ command: 'tool.approve', target: initial.pending[0].target }).then(({ result }) => {
        results.push(result)
      })
    )
    await ready.promise
    preflight.resolve()
    await executing.promise
    try {
      await vi.waitFor(() => expect(results).toHaveLength(1))
      expect(results[0].status).toBe('refused')
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBe(initial.runId)
      expect(m.route).toHaveBeenCalledOnce()
    } finally {
      effect.resolve()
      await Promise.all(attempts)
    }
    expect(results.map(({ status }) => status).sort()).toEqual(['completed', 'refused'])
  })
  it('finishes cancellation that races a drained suspension handoff', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const entered = deferred()
    const handoff = deferred()
    const pause = runState.suspendCopilotThread
    const spy = vi
      .spyOn(runState, 'suspendCopilotThread')
      .mockImplementationOnce(async (...args) => {
        entered.resolve()
        await handoff.promise
        return pause(...args)
      })
    const generating = message({ accessLevel: 'limited' })
    await entered.promise
    const [native] = (await m.agent.listSuspendedRuns()).runs
    const stopping = command({ command: 'cancel', threadId: native.threadId, runId: native.runId })
    try {
      await vi.waitFor(async () => expect(await isCopilotRunCancelled(native.runId)).toBe(true))
      expect(await readCopilotThreadRun(scope, native.threadId!)).toBe(native.runId)
    } finally {
      handoff.resolve()
      await generating
      expect((await stopping).result).toMatchObject({ status: 'cancel_requested' })
      spy.mockRestore()
    }
    expect(await readCopilotThreadRun(scope, native.threadId!)).toBeUndefined()
  })
  it('retains an admitted writer when native resume throws without a settlement handle', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const spy = vi
      .spyOn(m.agent, 'approveToolCall')
      .mockRejectedValueOnce(new Error('Unknown SDK start outcome'))
    try {
      expect(
        (await command({ command: 'tool.approve', target: initial.pending[0].target })).result
      ).toMatchObject({ status: 'failed' })
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBe(initial.runId)
      await expect(
        claimCopilotThread(scope, initial.threadId, 'competing-run')
      ).rejects.toMatchObject({ status: 409 })
    } finally {
      spy.mockRestore()
    }
  })
  it('preserves a known native suspension when pending discovery fails', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const spy = vi
      .spyOn(m.agent, 'listSuspendedRuns')
      .mockRejectedValueOnce(new Error('Storage unavailable'))
    try {
      expect((await message({ accessLevel: 'limited' })).result.status).toBe('failed')
      const [native] = (await m.agent.listSuspendedRuns()).runs
      expect(await readCopilotThreadRun(scope, native.threadId!)).toBe(native.runId)
      await expect(
        claimCopilotThread(scope, native.threadId!, 'competing-run')
      ).rejects.toMatchObject({ status: 409 })
      expect(
        (await command({ command: 'cancel', threadId: native.threadId, runId: native.runId }))
          .result
      ).toMatchObject({ status: 'cancel_requested' })
    } finally {
      spy.mockRestore()
    }
  })
  it.each(
    [409, 422].flatMap((status) => ['approval', 'review'].map((stage) => ({ status, stage })))
  )('blocks revoked configuration ($status) on cold $stage resume', async ({ status, stage }) => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Renamed' } })
    let initial = suspended((await message({ accessLevel: 'limited' })).result)
    if (stage === 'review') {
      m.route.mockResolvedValueOnce({ requiresReview: true, reviewBaseStateHash: 'original-base' })
      initial = suspended(
        (await command({ command: 'tool.approve', target: initial.pending[0].target })).result
      )
    }
    const admissions = m.admit.mock.calls.length
    const charges = m.accept.mock.calls.length
    const dispatches = m.route.mock.calls.length
    const receipts = m.receipts.size
    const models = vi.mocked(createConfiguredLanguageModel).mock.calls.length
    const error = new NativeTargetError(
      status === 409 ? 'The Copilot API key is not configured' : 'Copilot model unavailable',
      status
    )
    m.resolve.mockRejectedValue(error)
    restart()

    expect(
      (
        await command({
          command: stage === 'approval' ? 'tool.approve' : 'tool.execute',
          target: initial.pending[0].target,
          ...(stage === 'review' ? { action: 'review.accept' } : {}),
        })
      ).result
    ).toMatchObject({
      status: 'refused',
      error: { code: status === 409 ? 'STALE_TARGET' : 'INVALID_REQUEST', message: error.message },
    })
    expect(m.resolve).toHaveBeenLastCalledWith('configured/model')
    expect(m.route).toHaveBeenCalledTimes(dispatches)
    expect(m.receipts.size).toBe(receipts)
    expect(m.contacts).toHaveLength(1)
    expect(createConfiguredLanguageModel).toHaveBeenCalledTimes(models)
    expect(m.admit).toHaveBeenCalledTimes(admissions)
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(await pending(initial.threadId)).toEqual(initial.pending)
    expect(
      (await command({ command: 'history.read', threadId: initial.threadId })).result
    ).toMatchObject({ status: 'history' })
    expect(
      (await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId }))
        .result
    ).toMatchObject({ status: 'cancel_requested' })
    expect(threadClaims()).toHaveLength(0)
  })
  it('rejects a claimed run mismatch and makes unclaimed cancellation a harmless no-op', async () => {
    setModel(
      { tool: 'rename_workflow', args: { entityId: 'first', name: 'First' } },
      { tool: 'rename_workflow', args: { entityId: 'second', name: 'Second' } }
    )
    const first = suspended((await message()).result)
    const second = suspended((await message()).result)
    const cancel = { command: 'cancel', threadId: first.threadId, runId: second.runId }
    expect((await command(cancel)).response.status).toBe(403)
    expect(await isCopilotRunCancelled(first.runId)).toBe(false)
    await command({ ...cancel, runId: first.runId })
    expect((await command(cancel)).result).toMatchObject({ status: 'cancel_requested' })
    expect(await isCopilotRunCancelled(second.runId)).toBe(false)
    expect(await pending(second.threadId)).toHaveLength(1)
  })
  it('deletes cancelled native suspensions and their application receipts with the conversation', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Renamed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    vi.spyOn(m.agent, 'abortThreadStream').mockReturnValueOnce(false)
    await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId })
    expect((await m.agent.listSuspendedRuns({ threadId: initial.threadId })).runs).toHaveLength(1)
    expect(
      (await command({ command: 'thread.delete', threadId: initial.threadId })).result
    ).toMatchObject({ status: 'updated', operation: 'thread.delete' })
    expect((await m.agent.listSuspendedRuns({ threadId: initial.threadId })).runs).toEqual([])
    expect(await m.memory.getThreadById({ threadId: initial.threadId })).toBeNull()
    expect(await isCopilotRunCancelled(initial.runId)).toBe(false)
    expect(threadClaims()).toHaveLength(0)
  })

  it.each(['timeout', 'aborted'])(
    'does not unlock an interrupted writer when cancellation waiting is %s',
    async (reason) => {
      setModel({ text: 'Original answer' }, { text: 'New conversation' })
      const initial = (await message()).result
      if (initial.status !== 'completed') throw new Error(JSON.stringify(initial))
      await claimCopilotThread(scope, initial.threadId, initial.runId)
      const deadline = new AbortController()
      const abort = new AbortController()
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal)
      try {
        const stopping = executeCopilotCommand(
          {
            command: 'cancel',
            workspaceId: scope.workspaceId,
            threadId: initial.threadId,
            runId: initial.runId,
          },
          scope.actorUserId,
          abort.signal
        )
        await vi.waitFor(async () => expect(await isCopilotRunCancelled(initial.runId)).toBe(true))
        if (reason === 'timeout') deadline.abort(new DOMException('Timed out', 'TimeoutError'))
        else abort.abort(new DOMException('Cancelled request', 'AbortError'))
        const response = await stopping
        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({ status: 'failed' })
        expect(await readCopilotThreadRun(scope, initial.threadId)).toBe(initial.runId)
      } finally {
        timeout.mockRestore()
      }
      const blocked = (await message({ threadId: initial.threadId })).result
      expect(blocked).toMatchObject({
        status: 'refused',
        error: { message: expect.stringContaining('new conversation') },
      })
      expect(
        (await command({ command: 'thread.delete', threadId: initial.threadId })).result
      ).toMatchObject({ status: 'refused' })
      const next = (await message()).result
      expect(next).toMatchObject({ status: 'completed', text: 'New conversation' })
      if (next.status !== 'completed') throw new Error(JSON.stringify(next))
      expect(next.threadId).not.toBe(initial.threadId)
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBe(initial.runId)
    }
  )
  it.each([false, true])(
    'waits for the native writer before cancelling and editing (other instance: %s)',
    async (otherInstance) => {
      setModel({ text: 'Original answer' }, { text: 'Delayed persisted answer' })
      const initial = (await message()).result
      if (initial.status !== 'completed') throw new Error(JSON.stringify(initial))
      const memory = (await m.storage.getStore('memory'))!
      const save = memory.saveMessages.bind(memory)
      let entered!: () => void
      const writing = new Promise<void>((resolve) => {
        entered = resolve
      })
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let held = false
      let persisted = false
      const spy = vi.spyOn(memory, 'saveMessages').mockImplementation(async (args) => {
        if (!held && args.messages.some((item) => item.role === 'assistant')) {
          held = true
          entered()
          await gate
        }
        const result = await save(args)
        if (held) persisted = true
        return result
      })
      try {
        const response = await executeCopilotCommand(
          {
            workspaceId: scope.workspaceId,
            command: 'message',
            model: 'configured/model',
            threadId: initial.threadId,
            input: { content: 'Keep ownership until persisted' },
          },
          scope.actorUserId
        )
        const reader = response.body!.getReader()
        const started = await reader.read()
        const first = JSON.parse(new TextDecoder().decode(started.value).slice(6).trim())
        const next = reader.read()
        await writing
        let observed = ''
        let closing: Promise<unknown>
        if (otherInstance) {
          restart()
          closing = (async () => {
            let chunk = await next
            while (!chunk.done) {
              observed += new TextDecoder().decode(chunk.value)
              chunk = await reader.read()
            }
          })()
        } else closing = reader.cancel()
        let acknowledged = false
        const stopping = executeCopilotCommand(
          {
            command: 'cancel',
            workspaceId: scope.workspaceId,
            threadId: first.threadId,
            runId: first.runId,
          },
          scope.actorUserId
        ).then((response) => {
          acknowledged = true
          return response
        })
        await vi.waitFor(async () => expect(await isCopilotRunCancelled(first.runId)).toBe(true))
        if (otherInstance)
          await vi.waitFor(() => expect((m.contacts.at(-1) as any).abortSignal.aborted).toBe(true))
        expect(acknowledged).toBe(false)
        expect(observed).not.toContain('response.cancel_requested')
        expect(await readCopilotThreadRun(scope, first.threadId)).toBe(first.runId)
        expect(persisted).toBe(false)
        expect((await message({ threadId: first.threadId })).result).toMatchObject({
          status: 'refused',
        })
        release()
        await next
        await closing
        expect(await (await stopping).json()).toMatchObject({
          status: 'cancel_requested',
          runId: first.runId,
        })
        expect(persisted).toBe(true)
        expect(await readCopilotThreadRun(scope, first.threadId)).toBeUndefined()
        if (otherInstance) expect(observed).toContain('response.cancel_requested')
        const history = await memory.listMessages({
          threadId: first.threadId,
          resourceId: nativeConversationIdentity(scope).resourceId,
          perPage: false,
          orderBy: { field: 'createdAt', direction: 'ASC' },
        })
        expect(
          history.messages.some((item) => item.role === 'user' && item.id === first.messageId)
        ).toBe(true)
        expect(
          (
            await message({
              threadId: first.threadId,
              messageId: history.messages[0].id,
              input: { content: 'Edited prompt' },
            })
          ).result
        ).toMatchObject({ status: 'completed' })
      } finally {
        release()
        spy.mockRestore()
      }
    }
  )
})
