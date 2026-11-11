/** @vitest-environment node */
import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore, type MastraCompositeStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { PostgresStore } from '@mastra/pg'
import postgres from 'postgres'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotRequest, CopilotResponse, Scope } from '@/lib/copilot/native/contract'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { readNativeEvents } from '@/lib/copilot/native/stream'
import { assertAcceptedServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import { createCopilotAgent } from './agent'
import { executeCopilotCommand } from './service'
import type { CopilotRun } from './state'

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
  runs: new Map<string, CopilotRun>(),
  claims: new Map<string, string>(),
  cancelled: new Set<string>(),
  effects: new Map<string, string>(),
}))
vi.mock('@/lib/mastra/runtime', () => ({
  getCopilotAgent: async () => m.agent,
  getAgentMemory: async () => m.memory,
  getNativeMemoryStore: async () => m.storage.getStore('memory'),
  getNativeWorkflowsStore: async () => m.storage.getStore('workflows'),
}))
vi.mock('@/lib/mastra/connections', () => ({ createConfiguredLanguageModel: () => m.model }))
vi.mock('@/lib/mastra/registry', () => ({ assertListedModel: vi.fn() }))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => m.access(...args),
}))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: (...args: unknown[]) => m.admit(...args),
  recordModelUsage: (...args: unknown[]) => m.accept(...args),
}))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: (...args: unknown[]) => m.business(...args),
}))
vi.mock('@/lib/copilot/native/readback', () => ({ readbackNativeToolResult: vi.fn() }))
vi.mock('@/lib/copilot/tools/server/router', () => ({
  routeExecution: (...args: unknown[]) => m.route(...args),
}))
vi.mock('./state', async () => {
  const { NativeTargetError } = await import('@/lib/copilot/native/errors')
  const json = (value: unknown) => JSON.stringify(value)
  const copy = <T>(value: T): T => JSON.parse(json(value))
  const claimKey = (scope: Scope, threadId: string) => json([scope, threadId])
  return {
    saveCopilotRun: async (run: CopilotRun) => {
      m.runs.set(run.runId, copy(run))
    },
    readCopilotRun: async (scope: Scope, runId: string) => {
      const run = m.runs.get(runId)
      if (!run || json(run.scope) !== json(scope))
        throw new NativeTargetError('Foreign Copilot run', 403)
      return copy(run)
    },
    claimCopilotThread: async (scope: Scope, threadId: string, runId: string) => {
      const key = claimKey(scope, threadId)
      if (m.claims.has(key))
        throw new NativeTargetError(
          'This conversation has an unfinished turn. Start a new conversation if it was interrupted.',
          409
        )
      m.claims.set(key, runId)
    },
    releaseCopilotThread: async (scope: Scope, threadId: string, runId: string) => {
      const key = claimKey(scope, threadId)
      if (m.claims.get(key) === runId) m.claims.delete(key)
    },
    deleteCopilotThread: async (scope: Scope, threadId: string) => {
      const key = claimKey(scope, threadId)
      if (m.claims.has(key)) throw new NativeTargetError('Thread already active', 409)
      const workflows = (await m.storage.getStore('workflows'))!
      for (const run of m.runs.values()) {
        if (run.threadId !== threadId || json(run.scope) !== json(scope)) continue
        let snapshot = await workflows.getWorkflowRunById({ runId: run.runId })
        while (snapshot) {
          await workflows.deleteWorkflowRunById({
            runId: run.runId,
            workflowName: snapshot.workflowName,
          })
          snapshot = await workflows.getWorkflowRunById({ runId: run.runId })
        }
      }
      await m.memory.deleteThread(threadId)
      for (const [runId, run] of m.runs) {
        if (run.threadId === threadId && json(run.scope) === json(scope)) {
          m.runs.delete(runId)
          m.cancelled.delete(runId)
          for (const key of m.effects.keys())
            if (JSON.parse(key)[0] === runId) m.effects.delete(key)
        }
      }
    },
    cancelCopilotRun: async (runId: string) => {
      m.cancelled.add(runId)
    },
    isCopilotRunCancelled: async (runId: string) => m.cancelled.has(runId),
    assertCopilotRunActive: async (runId: string) => {
      if (m.cancelled.has(runId)) throw new NativeTargetError('Cancelled run', 409)
    },
    runCopilotEffectOnce: async (
      runId: string,
      toolCallId: string,
      phase: string,
      input: unknown,
      execute: () => Promise<unknown>
    ) => {
      const key = json([runId, toolCallId, phase])
      const fingerprint = json(input)
      if (m.effects.has(key)) throw new NativeTargetError('Previously dispatched action', 409)
      m.effects.set(key, fingerprint)
      return execute()
    },
  }
})

const scope: Scope = { actorUserId: 'actor', workspaceId: 'workspace' }
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
  | { text: string }
  | { tool: string; args: Record<string, unknown>; toolCallId?: string }
function setModel(...steps: ResponseStep[]) {
  let index = 0
  m.model = new MastraLanguageModelV2Mock({
    doStream: async (request) => {
      m.contacts.push(request)
      const step = steps[index++] ?? { text: 'Done' }
      return {
        stream: new ReadableStream({
          start(controller) {
            if ('tool' in step)
              controller.enqueue({
                type: 'tool-call',
                toolCallId: step.toolCallId ?? 'original-tool-call',
                toolName: step.tool,
                input: JSON.stringify(step.args),
              })
            else {
              controller.enqueue({ type: 'text-start', id: 'answer' })
              controller.enqueue({ type: 'text-delta', id: 'answer', delta: step.text })
              controller.enqueue({ type: 'text-end', id: 'answer' })
            }
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

async function command(input: Record<string, unknown>) {
  const selected = (input.scope ?? scope) as Scope
  const { scope: _scope, ...fields } = input
  const response = await executeCopilotCommand(
    { workspaceId: selected.workspaceId, ...fields } as CopilotRequest,
    selected.actorUserId
  )
  let body: CopilotResponse | undefined
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    for await (const event of readNativeEvents(response.body!))
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
    command: 'pending.list',
    threadId,
    page: { page: 0, perPage: 100 },
  })
  expect(result.status).toBe('pending_targets')
  if (result.status !== 'pending_targets') throw new Error(JSON.stringify(result))
  return result.items
}

beforeEach(() => {
  vi.clearAllMocks()
  m.route.mockReset()
  m.contacts.length = 0
  m.runs.clear()
  m.claims.clear()
  m.cancelled.clear()
  m.effects.clear()
  m.access.mockResolvedValue({ hasAccess: true })
  m.fetch.mockRejectedValue(new Error('External Copilot is unavailable'))
  vi.stubGlobal('fetch', m.fetch)
  m.admit.mockResolvedValue(undefined)
  m.accept.mockResolvedValue(undefined)
  m.business.mockResolvedValue(undefined)
  m.storage = new InMemoryStore()
  restart()
})
afterEach(() => vi.unstubAllGlobals())

describe('built-in Copilot service bridge', () => {
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
        page: { page: 0, perPage: 100 },
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
    setModel(
      { tool: 'list_workflows', args: { workspaceId: 'workspace' } },
      { text: 'One known workflow' }
    )
    m.route.mockResolvedValueOnce({
      entityKind: 'workflow',
      entities: [{ entityId: 'workflow', entityName: 'Known' }],
      count: 1,
    })
    const { result } = await message({ accessLevel: 'full' })
    expect(result).toMatchObject({
      status: 'completed',
      text: 'One known workflow',
    })
    expect(m.route).toHaveBeenCalledExactlyOnceWith(
      'list_workflows',
      { workspaceId: 'workspace' },
      expect.objectContaining({ userId: 'actor', workspaceId: 'workspace' })
    )
    expect(m.admit).toHaveBeenCalledTimes(2)
    expect(m.accept).toHaveBeenCalledTimes(2)
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it('gives the model current Studio context while persisting and editing only the visible input', async () => {
    setModel({ text: 'Initial answer' }, { text: 'Follow-up answer' })
    const context = { entityId: 'workflow', resolvedContent: 'Private current Studio context' }
    const { result } = await message({ input: { content: 'Hello', contexts: [context] } })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') throw new Error(JSON.stringify(result))
    expect(JSON.stringify(m.contacts[0])).toContain(context.resolvedContent)
    const history = (
      await command({
        command: 'history.read',
        threadId: result.threadId,
        page: { page: 0, perPage: 100 },
      })
    ).result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    expect(history.items[0].parts).toMatchObject([{ type: 'text', text: 'Hello' }])
    expect(JSON.stringify(history)).not.toContain(context.resolvedContent)
    expect(
      (
        await command({
          command: 'history.edit',
          threadId: result.threadId,
          messageId: history.items[0].id,
          text: 'Edited hello',
        })
      ).result.status
    ).toBe('updated')
    restart()
    expect(
      (await message({ threadId: result.threadId, input: { content: 'Follow up' } })).result.status
    ).toBe('completed')
    expect(JSON.stringify(m.contacts[1])).toContain('Edited hello')
    expect(JSON.stringify(m.contacts[1])).not.toContain(context.resolvedContent)
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
    for await (const event of readNativeEvents(response.body!, {})) events.push(event)
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

  it('recovers the original preview after restart and applies a decision once', async () => {
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
    const context = { entityId: 'workflow', resolvedContent: 'Current rename context' }
    const initial = suspended(
      (
        await message({
          accessLevel: 'limited',
          input: { content: 'Rename the workflow', contexts: [context] },
        })
      ).result
    )
    expect(initial.pending[0].stage).toBe('approval')
    expect(m.route).not.toHaveBeenCalled()
    restart()
    const approved = suspended(
      (await command({ command: 'tool.approve', target: initial.pending[0].target })).result
    )
    expect(approved.pending[0]).toMatchObject({
      stage: 'result',
      originalArgs: args,
      preview: { requiresReview: true },
    })
    expect(approved.pending[0]).not.toHaveProperty('reviewBaseStateHash')
    expect(approved.pending[0].preview).not.toHaveProperty('reviewBaseStateHash')
    expect(approved.pending[0].preview).not.toHaveProperty('reviewToken')
    expect(m.route).toHaveBeenCalledOnce()
    restart()
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
    expect(JSON.stringify(m.contacts[1])).toContain(context.resolvedContent)
    expect(m.route).toHaveBeenLastCalledWith(
      'rename_workflow',
      args,
      expect.objectContaining({ accessLevel: 'full', acceptedReviewBaseStateHash: 'original-base' })
    )
    const contacts = m.contacts.length
    expect((await command(decision)).result).toMatchObject({
      status: 'refused',
      error: { code: 'STALE_TARGET' },
    })
    expect(m.route).toHaveBeenCalledTimes(2)
    expect(m.contacts).toHaveLength(contacts)
  })

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
          page: { page: 0, perPage: 100 },
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
    expect(m.claims.size).toBe(0)
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
    expect(m.runs.has(initial.runId)).toBe(false)
    expect(m.cancelled.has(initial.runId)).toBe(false)
    expect(m.claims.size).toBe(0)
  })

  it('allows a new conversation while refusing to unlock an interrupted ordinary writer', async () => {
    setModel({ text: 'Original answer' }, { text: 'New conversation' })
    const initial = (await message()).result
    if (initial.status !== 'completed') throw new Error(JSON.stringify(initial))
    m.claims.set(JSON.stringify([scope, initial.threadId]), initial.runId)
    await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId })
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
    expect(m.claims.get(JSON.stringify([scope, initial.threadId]))).toBe(initial.runId)
  })
  it('keeps thread ownership until native memory finishes after the HTTP observer disconnects', async () => {
    setModel({ text: 'Delayed persisted answer' })
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
          input: { content: 'Keep ownership until persisted' },
        },
        scope.actorUserId
      )
      const reader = response.body!.getReader()
      const started = await reader.read()
      const first = JSON.parse(new TextDecoder().decode(started.value).slice(6).trim())
      const next = reader.read()
      await writing
      const closing = reader.cancel()
      expect(m.claims.get(JSON.stringify([scope, first.threadId]))).toBe(first.runId)
      expect(persisted).toBe(false)
      expect((await message({ threadId: first.threadId })).result).toMatchObject({
        status: 'refused',
      })
      release()
      await next
      await closing
      expect(persisted).toBe(true)
      expect(m.claims.has(JSON.stringify([scope, first.threadId]))).toBe(false)
    } finally {
      release()
      spy.mockRestore()
    }
  })
})

const databaseUrl = process.env.MASTRA_TEST_DATABASE_URL
it.runIf(Boolean(databaseUrl))(
  'resumes the actual Studio service in a fresh context without persisting runtime callbacks',
  async () => {
    const url = new URL(databaseUrl!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_disposable'))
      throw new Error('A disposable loopback database is required')
    const schema = `copilot_context_${crypto.randomUUID().replaceAll('-', '')}`
    const storage = new PostgresStore({
      id: schema,
      connectionString: databaseUrl!,
      schemaName: schema,
    })
    const owner = postgres(databaseUrl!, { max: 1 })
    try {
      await storage.init()
      m.storage = storage
      restart()
      const args = { entityId: 'workflow', name: 'Renamed' }
      setModel({ tool: 'rename_workflow', args }, { text: 'Native continuation completed' })
      m.route
        .mockResolvedValueOnce({ requiresReview: true, reviewBaseStateHash: 'current-base' })
        .mockResolvedValueOnce({
          success: true,
          workspaceId: 'workspace',
          entityKind: 'workflow',
          entityId: 'workflow',
          entityName: 'Renamed',
        })
      const context = { entityId: 'workflow', resolvedContent: 'Postgres native resume context' }
      const initial = suspended(
        (
          await message({
            accessLevel: 'limited',
            input: { content: 'Rename the workflow', contexts: [context] },
          })
        ).result
      )
      const workflows = (await storage.getStore('workflows'))!
      expect(
        JSON.stringify(await workflows.getWorkflowRunById({ runId: initial.runId }))
      ).not.toContain('copilot-execution')
      restart()
      const approved = suspended(
        (await command({ command: 'tool.approve', target: initial.pending[0].target })).result
      )
      restart()
      expect(
        (
          await command({
            command: 'tool.execute',
            target: approved.pending[0].target,
            action: 'review.accept',
          })
        ).result
      ).toMatchObject({ status: 'completed', text: 'Native continuation completed' })
      expect(JSON.stringify(m.contacts[1])).toContain(context.resolvedContent)
      const history = (
        await command({
          command: 'history.read',
          threadId: initial.threadId,
          page: { page: 0, perPage: 100 },
        })
      ).result
      if (history.status !== 'history') throw new Error(JSON.stringify(history))
      expect(history.items[0].parts).toMatchObject([{ type: 'text', text: 'Rename the workflow' }])
      expect(JSON.stringify(history)).not.toContain(context.resolvedContent)
      expect(m.route).toHaveBeenLastCalledWith(
        'rename_workflow',
        args,
        expect.objectContaining({
          userId: scope.actorUserId,
          acceptedReviewBaseStateHash: 'current-base',
        })
      )
    } finally {
      await storage.close()
      await owner.unsafe(`drop schema "${schema}" cascade`)
      await owner.end()
    }
  },
  30000
)
