/** @vitest-environment node */
import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import type { FinancialBinding, ModelOccurrence } from '@tradinggoose/billing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotRequest, CopilotResponse, Scope } from '@/lib/copilot/native/contract'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'
import { readNativeEvents } from '@/lib/copilot/native/stream'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { createCopilotAgent } from './agent'
import { executeCopilotCommand } from './service'
import type { CopilotRun } from './state'

const m = vi.hoisted(() => ({
  storage: undefined as unknown as InMemoryStore,
  memory: undefined as unknown as Memory,
  agent: undefined as unknown as ReturnType<typeof createCopilotAgent>,
  model: undefined as unknown as MastraLanguageModelV2Mock,
  contacts: [] as unknown[],
  access: vi.fn(),
  fetch: vi.fn(),
  create: vi.fn(),
  admit: vi.fn(),
  accept: vi.fn(),
  verify: vi.fn(),
  route: vi.fn(),
  stage: vi.fn(),
  reviewAccept: vi.fn(),
  reviewReject: vi.fn(),
  business: vi.fn(),
  runs: new Map<string, CopilotRun>(),
  claims: new Map<string, string>(),
  cancelled: new Set<string>(),
  effects: new Map<string, { fingerprint: string; result?: unknown; completed: boolean }>(),
  receipts: new Map<string, { appliedUsd: string }>(),
}))
vi.mock('@/lib/mastra/runtime', () => ({
  getCopilotAgent: async () => m.agent,
  getCopilotMemory: async () => m.memory,
  getNativeMemoryStore: async () => m.storage.getStore('memory'),
}))
vi.mock('@/lib/mastra/connections', () => ({ createConfiguredLanguageModel: () => m.model }))
vi.mock('@/lib/mastra/registry', () => ({ assertListedModel: vi.fn() }))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => m.access(...args),
}))
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: (...args: unknown[]) => m.create(...args),
  admitFinancialModelStep: (...args: unknown[]) => m.admit(...args),
  acceptFinancialModelStep: (...args: unknown[]) => m.accept(...args),
  verifyFinancialAcceptance: (...args: unknown[]) => m.verify(...args),
}))
vi.mock('@/lib/copilot/native/business-access', () => ({
  authorizeNativeBusinessResult: (...args: unknown[]) => m.business(...args),
}))
vi.mock('@/lib/copilot/native/readback', () => ({ readbackNativeToolResult: vi.fn() }))
vi.mock('@/lib/copilot/tools/server/base-tool', () => ({
  hashServerToolReviewBase: () => 'bound-review',
}))
vi.mock('@/lib/copilot/tools/server/router', () => ({
  routeExecution: (...args: unknown[]) => m.route(...args),
}))
vi.mock('@/lib/copilot/tools/server/review-acceptance', () => ({
  stageServerManagedToolReview: (...args: unknown[]) => m.stage(...args),
  acceptServerManagedToolReview: (...args: unknown[]) => m.reviewAccept(...args),
  rejectServerManagedToolReview: (...args: unknown[]) => m.reviewReject(...args),
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
    saveCopilotOccurrence: async (run: CopilotRun, occurrence: ModelOccurrence) => {
      run.occurrence = occurrence
      m.runs.set(run.runId, copy(run))
    },
    claimCopilotThread: async (scope: Scope, threadId: string, runId: string) => {
      const key = claimKey(scope, threadId)
      if (m.claims.has(key)) throw new NativeTargetError('Thread already active', 409)
      m.claims.set(key, runId)
    },
    releaseCopilotThread: async (scope: Scope, threadId: string, runId: string) => {
      const key = claimKey(scope, threadId)
      if (m.claims.get(key) === runId) m.claims.delete(key)
    },
    assertCopilotThreadIdle: async (scope: Scope, threadId: string) => {
      if (m.claims.has(claimKey(scope, threadId)))
        throw new NativeTargetError('Thread already active', 409)
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
      const prior = m.effects.get(key)
      if (prior) {
        if (prior.fingerprint !== fingerprint || !prior.completed)
          throw new NativeTargetError('Previously dispatched action', 409)
        return copy(prior.result)
      }
      m.effects.set(key, { fingerprint, completed: false })
      const result = await execute()
      m.effects.set(key, { fingerprint, completed: true, result: copy(result) })
      return result
    },
  }
})

const scope: Scope = { actorUserId: 'actor', workspaceId: 'workspace' }
const receiptKey = (binding: FinancialBinding, occurrence: ModelOccurrence) =>
  stableStringifyJsonValue([binding.runId, occurrence.stepNumber, occurrence.retryCount])

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
  const response = await executeCopilotCommand({
    requestId: crypto.randomUUID(),
    scope,
    ...input,
  } as CopilotRequest)
  return { response, result: (await response.json()) as CopilotResponse }
}
async function message(extra: Record<string, unknown> = {}) {
  return command({
    command: 'message',
    model: 'configured/model',
    input: { content: 'Original request🔥' },
    stream: false,
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
  m.contacts.length = 0
  m.runs.clear()
  m.claims.clear()
  m.cancelled.clear()
  m.effects.clear()
  m.receipts.clear()
  m.access.mockResolvedValue({ hasAccess: true })
  m.fetch.mockRejectedValue(new Error('External Copilot is unavailable'))
  vi.stubGlobal('fetch', m.fetch)
  m.create.mockImplementation(async (input) => ({
    actorUserId: input.actorUserId,
    runId: input.runId,
    purpose: input.purpose,
    namespace: 'billing:workspace',
    key: `invocation:${input.runId}`,
    fingerprint: `binding:${input.runId}`,
    workspaceId: input.workspaceId ?? null,
    workflowId: input.workflowId ?? null,
  }))
  m.admit.mockResolvedValue(undefined)
  m.accept.mockImplementation(async (binding, occurrence) => {
    const receipt = { appliedUsd: '0.1' }
    m.receipts.set(receiptKey(binding, occurrence), receipt)
    return receipt
  })
  m.verify.mockImplementation(async (binding, occurrence) => {
    const receipt = m.receipts.get(receiptKey(binding, occurrence))
    if (!receipt) throw new NativeTargetError('Model occurrence was not accepted', 403)
    return receipt
  })
  m.business.mockResolvedValue(undefined)
  m.stage.mockImplementation(async (_name, _args, result) => result)
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
      financial: { appliedUsd: '0.1' },
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
    expect(m.create).toHaveBeenCalledTimes(2)
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
      financial: { appliedUsd: '0.2' },
    })
    expect(m.route).toHaveBeenCalledExactlyOnceWith(
      'list_workflows',
      { workspaceId: 'workspace' },
      expect.objectContaining({ userId: 'actor', workspaceId: 'workspace' })
    )
    expect(m.create).toHaveBeenCalledOnce()
    expect(m.admit).toHaveBeenCalledTimes(2)
    expect(m.accept).toHaveBeenCalledTimes(2)
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it('streams validated Studio events through server-tool continuation', async () => {
    setModel(
      { tool: 'list_workflows', args: { workspaceId: 'workspace' } },
      { text: 'Known workflows' }
    )
    m.route.mockResolvedValueOnce({ entityKind: 'workflow', entities: [], count: 0 })
    const requestId = crypto.randomUUID()
    const response = await executeCopilotCommand({
      requestId,
      scope,
      command: 'message',
      model: 'configured/model',
      input: { content: 'Do not expose this prompt in raw transport' },
      accessLevel: 'full',
      stream: true,
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const events = []
    for await (const event of readNativeEvents(response.body!, 'CopilotEvent', { requestId }))
      events.push(event)
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

  it('preserves native limited approval and preview acceptance after a restart, rejecting stale and duplicate delivery before billing', async () => {
    const args = { entityId: 'workflow', name: 'Renamed' }
    const preview = {
      requiresReview: true,
      reviewToken: 'preview-token',
      reviewBaseStateHash: 'original-base',
    }
    setModel({ tool: 'rename_workflow', args }, { text: 'Renamed successfully' })
    m.route.mockResolvedValueOnce(preview)
    m.reviewAccept.mockResolvedValueOnce({
      success: true,
      workspaceId: 'workspace',
      entityKind: 'workflow',
      entityId: 'workflow',
      entityName: 'Renamed',
    })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    expect(initial.pending[0].stage).toBe('approval')
    expect(initial.pending[0]).not.toHaveProperty('financialBinding')
    expect(initial.pending[0]).not.toHaveProperty('financialOccurrence')
    expect(m.runs.get(initial.runId)?.binding).toMatchObject({
      actorUserId: scope.actorUserId,
      workspaceId: scope.workspaceId,
      runId: initial.runId,
      purpose: 'copilot',
    })
    expect(m.route).not.toHaveBeenCalled()
    restart()
    const approval = (await pending(initial.threadId))[0]
    const approved = suspended(
      (await command({ command: 'tool.approve', target: approval.target, stream: false })).result
    )
    expect(approved.pending[0]).toMatchObject({ stage: 'result', preview, originalArgs: args })
    expect(approved.pending[0]).not.toHaveProperty('financialBinding')
    expect(approved.pending[0]).not.toHaveProperty('financialOccurrence')
    expect(m.route).toHaveBeenCalledOnce()
    expect(m.reviewAccept).not.toHaveBeenCalled()
    const charges = m.accept.mock.calls.length
    const admissions = m.admit.mock.calls.length
    const tokenRequest = {
      command: 'tool.execute',
      target: approved.pending[0].target,
      action: 'review.accept',
      stream: false,
    }
    restart()
    expect((await command({ ...tokenRequest, reviewToken: 'stale-token' })).result).toMatchObject({
      status: 'refused',
      error: { code: 'STALE_TARGET' },
    })
    expect(m.reviewAccept).not.toHaveBeenCalled()
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(m.admit).toHaveBeenCalledTimes(admissions)
    const publicPreview = (await pending(initial.threadId))[0]
    expect(publicPreview.preview).toEqual(preview)
    expect(publicPreview).not.toHaveProperty('financialBinding')
    expect(publicPreview).not.toHaveProperty('financialOccurrence')
    expect((await command({ ...tokenRequest, reviewToken: 'preview-token' })).result).toMatchObject(
      { status: 'completed', text: 'Renamed successfully' }
    )
    expect(m.reviewAccept).toHaveBeenCalledOnce()
    const acceptedCharges = m.accept.mock.calls.length
    const acceptedAdmissions = m.admit.mock.calls.length
    expect((await command({ ...tokenRequest, reviewToken: 'preview-token' })).result).toMatchObject(
      { status: 'refused', error: { code: 'STALE_TARGET' } }
    )
    expect(m.reviewAccept).toHaveBeenCalledOnce()
    expect(m.route).toHaveBeenCalledOnce()
    expect(m.create).toHaveBeenCalledOnce()
    expect(m.accept).toHaveBeenCalledTimes(acceptedCharges)
    expect(m.admit).toHaveBeenCalledTimes(acceptedAdmissions)
  })

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
    expect(m.create).not.toHaveBeenCalled()
    expect(m.admit).not.toHaveBeenCalled()
    m.access.mockResolvedValueOnce({ hasAccess: false })
    await expect(message()).rejects.toMatchObject({ status: 403 })
    expect(m.contacts).toHaveLength(0)
    expect(m.create).not.toHaveBeenCalled()
  })

  it('durably cancels pending work so another instance cannot resume generation or effects', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Renamed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const original = initial.pending[0]
    const charges = m.accept.mock.calls.length
    expect(
      (await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId }))
        .result
    ).toMatchObject({ status: 'cancel_requested', acknowledged: true, uncertaintyRemains: true })
    restart()
    expect(await pending(initial.threadId)).toEqual([])
    expect(
      (await command({ command: 'tool.approve', target: original.target, stream: false })).result
    ).toMatchObject({ status: 'refused' })
    expect(m.route).not.toHaveBeenCalled()
    expect(m.contacts).toHaveLength(1)
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(m.claims.size).toBe(0)
  })
})
