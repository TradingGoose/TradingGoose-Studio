/** @vitest-environment node */

import { AGENT_CONTROL_TOPIC, AgentControlEventTypes } from '@mastra/core/agent/durable'
import { EventEmitterPubSub } from '@mastra/core/events'
import { Mastra } from '@mastra/core/mastra'
import {
  InMemoryStore,
  type MastraCompositeStore,
  RunFenceConflictError,
} from '@mastra/core/storage'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COPILOT_CONTEXT_PART,
  type CopilotRequest,
  type CopilotResponse,
  type CopilotThreadEvent,
  type HistoryResponse,
  type Pending,
  type SafeError,
  type Scope,
} from '@/lib/copilot/native/contract'
import { NativeTargetError, ObserveResumedWorkflow } from '@/lib/copilot/native/errors'
import { nativeConversationIdentity, nativeToolCallId } from '@/lib/copilot/native/identity'
import { assertAcceptedServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import { readSseData } from '@/lib/events/stream'
import type { BackgroundExecutionTaskPayload } from '@/lib/execution/background-execution'
import { resolveConfiguredModel } from '@/lib/mastra/connections'
import * as runtime from '@/lib/mastra/runtime'
import { type NativeUsage, sumNativeUsage } from '@/lib/mastra/usage'
import { POST as handleWorkerRequest } from '@/app/api/copilot/native/tool/route'
import { createCopilotAgent } from './agent'
import { readCopilotRun } from './context'
import { claimCopilotThread, readCopilotThreadOwnership, THREAD_LEASE_MS } from './ownership'
import { cancelCopilotRun, isCopilotRunCancelled } from './receipts'
import { executeCopilotCommand, finalizeCopilotJob } from './service'
import { readCopilotThreadRun } from './state'
import { executeCopilotJob } from './worker'
import { handleCopilotWorkerOperation } from './worker-server'

const m = vi.hoisted(() => ({
  mastra: undefined as unknown as Mastra,
  storage: undefined as unknown as MastraCompositeStore,
  pubsub: undefined as unknown as EventEmitterPubSub,
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
  executionLog: vi.fn(),
  resolve: vi.fn(),
  contexts: vi.fn(),
  credential: vi.fn(),
  cancelInsert: vi.fn(),
  dispatch: vi.fn(),
  triggerState: vi.fn(),
  retrieveRun: vi.fn(),
  jobs: new Map<string, Extract<BackgroundExecutionTaskPayload, { executionType: 'copilot' }>>(),
  executions: new Map<string, Promise<void>>(),
  startJobs: true,
  receipts: new Map<string, { id: string; identifier: string; value: string }>(),
}))
vi.mock('@/lib/mastra/runtime', () => ({
  getMastra: async () => m.mastra,
  getCopilotAgent: async () => m.agent,
  getAgentMemory: async () => m.memory,
  getNativeMemoryStore: async () => m.storage.getStore('memory'),
  getNativeWorkflowsStore: async () => m.storage.getStore('workflows'),
  deleteNativeThread: vi.fn(
    async (
      threadId: string,
      _fence: unknown,
      cleanup: (transaction: {
        none: (query: string, values?: unknown[]) => Promise<null>
      }) => Promise<unknown>
    ) => {
      await m.memory.deleteThread(threadId)
      await cleanup({
        none: async (_query, values) => {
          for (const [id, row] of m.receipts)
            if (row.identifier === values?.[0]) m.receipts.delete(id)
          return null
        },
      })
    }
  ),
}))
vi.mock('@mastra/core/llm', async (original) => ({
  ...(await original<object>()),
  ModelRouterLanguageModel: class {
    constructor(config: unknown) {
      // biome-ignore lint/correctness/noConstructorReturn: Return the real Mastra SDK test model.
      return Object.assign(m.model, {
        config,
        resolveApiProviderId: async () => 'openai.responses',
      })
    }
  },
}))
vi.mock('@/lib/mastra/connections', () => ({
  resolveConfiguredModel: vi.fn(async (_model: string, apiKey?: string) => ({
    providerId: 'configured',
    modelId: 'model',
    apiKey,
  })),
}))
vi.mock('@/lib/execution/background-execution', () => ({
  dispatchBackgroundExecution: (...args: unknown[]) => m.dispatch(...args),
}))
vi.mock('@trigger.dev/sdk', async (original) => ({
  ...(await original<object>()),
  runs: { retrieve: (...args: unknown[]) => m.retrieveRun(...args) },
}))
vi.mock('@/lib/trigger/settings', () => ({
  getTriggerExecutionState: () => m.triggerState(),
}))
vi.mock('@/lib/copilot/settings.server', () => ({
  validateCopilotModel: vi.fn(),
  resolveCopilotModel: m.resolve,
}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
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
  readAuthorizedWorkflowExecutionLog: (...args: unknown[]) => m.executionLog(...args),
}))
vi.mock('@/lib/copilot/tools/server/workflow/check-deployment-status', () => ({
  checkDeploymentStatusServerTool: { execute: vi.fn() },
}))
vi.mock('@/lib/copilot/tools/server/router', () => ({
  routeExecution: (...args: unknown[]) => m.route(...args),
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
  },
}))
vi.mock('drizzle-orm', async (original) => ({
  ...(await original<object>()),
  eq: (field: { name: string }, value: unknown) => (row: Record<string, unknown>) =>
    row[field.name] === value,
}))

const scope: Scope = { actorUserId: 'actor', workspaceId: 'workspace' }
async function threadClaims() {
  const store = (await m.storage.getStore('workflows'))!
  const keys = new Set(vi.mocked(store.claimRunOwnership).mock.calls.map(([{ runId }]) => runId))
  return (await Promise.all([...keys].map((runId) => store.getRunOwnership({ runId })))).filter(
    (record) => record?.live
  )
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function restart() {
  m.memory = new Memory({ storage: m.storage })
  m.agent = createCopilotAgent(m.memory)
  m.mastra = new Mastra({
    agents: { copilot: m.agent },
    storage: m.storage,
    pubsub: m.pubsub,
    recovery: { workflows: 'off' },
  })
}

type MockToolCall = { tool: string; args: Record<string, unknown>; toolCallId?: string }
type ResponseStep =
  | { text: string | AsyncIterable<string> }
  | { error: Error }
  | (MockToolCall & { text?: string })
  | { tools: MockToolCall[] }
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
            for (const call of 'tools' in step ? step.tools : 'tool' in step ? [step] : [])
              controller.enqueue({
                type: 'tool-call',
                toolCallId: call.toolCallId ?? 'original-tool-call',
                toolName: call.tool,
                input: JSON.stringify(call.args),
              })
            if ('error' in step) controller.enqueue({ type: 'error', error: step.error })
            controller.enqueue({
              type: 'finish',
              finishReason:
                'error' in step
                  ? 'error'
                  : 'tool' in step || 'tools' in step
                    ? 'tool-calls'
                    : 'stop',
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

async function* readEvents<T = CopilotThreadEvent>(stream: ReadableStream<Uint8Array>) {
  for await (const data of readSseData(stream)) yield JSON.parse(data) as T
}
interface JobOutcome {
  status: 'success' | 'suspended' | 'failed' | 'aborted'
  threadId: string
  runId: string
  text: string
  pending: Pending[]
  error?: SafeError
  usage?: NativeUsage
}
type TestResult = CopilotResponse | HistoryResponse | JobOutcome

async function executeJob(id: string) {
  const row = m.jobs.get(id)!
  try {
    await executeCopilotJob(row.payload)
  } catch (error) {
    await finalizeCopilotJob(row.payload, error instanceof Error ? error.message : String(error))
  } finally {
    m.jobs.delete(id)
  }
}
async function command(
  input: Record<string, unknown>
): Promise<{ response: Response; result: TestResult }> {
  const selected = (input.scope ?? scope) as Scope
  const { scope: _scope, ...fields } = input
  if (fields.command === 'message' || String(fields.command).startsWith('tool.'))
    fields.requestId ??= crypto.randomUUID()
  const response = await executeCopilotCommand(
    { workspaceId: selected.workspaceId, ...fields } as CopilotRequest,
    selected.actorUserId
  )
  let body: TestResult
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const observer = readEvents(response.body!)
    try {
      const first = (await observer.next()).value
      if (first?.type !== 'thread.history') throw new Error('Expected initial native history')
      body = first.result
    } finally {
      await observer.return(undefined)
    }
  } else {
    body = (await response.json()) as CopilotResponse
    if (body.status === 'accepted') {
      const { threadId } = body
      const thread = await m.memory.getThreadById({ threadId })
      const job = thread!.metadata!.copilotJob as { id: string }
      await m.executions.get(job.id)
      const current = await m.memory.getThreadById({ threadId })
      const outcome = current!.metadata!.copilotJob as Pick<
        JobOutcome,
        'status' | 'error' | 'runId'
      >
      const { result } = await command({ scope: selected, command: 'thread.observe', threadId })
      if (result.status !== 'history') throw new Error('Expected completed native history')
      const messages = result.items.filter(
        (item) => item.role === 'assistant' && item.runId === outcome.runId
      )
      body = {
        ...outcome,
        threadId,
        text:
          messages
            .at(-1)
            ?.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
            .join('') ?? '',
        pending: result.pending,
        usage: sumNativeUsage(messages),
      }
    }
  }
  return { response, result: body }
}
async function message(extra: Record<string, unknown> = {}) {
  return command({
    command: 'message',
    model: 'configured/model',
    input: { content: 'Original request🔥' },
    ...extra,
  })
}
function suspended(result: TestResult) {
  expect(result.status).toBe('suspended')
  if (result.status !== 'suspended') throw new Error(JSON.stringify(result))
  return result
}
async function pending(threadId: string) {
  const { result } = await command({
    command: 'thread.observe',
    threadId,
  })
  expect(result.status).toBe('history')
  if (result.status !== 'history') throw new Error(JSON.stringify(result))
  return result.pending
}

beforeEach(async () => {
  vi.clearAllMocks()
  m.route.mockReset()
  m.resolve.mockReset().mockImplementation(async (model: string) => ({
    model,
    apiKey: 'admin-key',
  }))
  m.contacts.length = 0
  m.receipts.clear()
  m.jobs.clear()
  m.executions.clear()
  m.startJobs = true
  m.triggerState.mockReset().mockResolvedValue({ mode: 'local' })
  m.retrieveRun.mockReset().mockResolvedValue({ isCompleted: false })
  m.dispatch.mockReset().mockImplementation(async (job, mode) => {
    m.jobs.set(job.id, job)
    if (m.startJobs)
      m.executions.set(
        job.id,
        new Promise<void>((resolve) => setImmediate(resolve)).then(() => executeJob(job.id))
      )
    return mode === 'trigger' ? `trigger-${job.id}` : undefined
  })
  m.access.mockResolvedValue({ hasAccess: true })
  m.fetch.mockRejectedValue(new Error('Unexpected network request'))
  vi.stubEnv('INTERNAL_API_SECRET', 'copilot-service-test-signing-secret-123456')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studio.example.test')
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    return new URL(request.url).pathname === '/api/copilot/native/tool'
      ? handleWorkerRequest(request)
      : m.fetch(input, init)
  })
  m.admit.mockResolvedValue(undefined)
  m.accept.mockImplementation(async (_scope, _usage, cost) => cost)
  m.business.mockResolvedValue(undefined)
  m.executionLog.mockReset()
  m.contexts.mockReset().mockResolvedValue([])
  m.credential.mockReset()
  m.cancelInsert.mockReset().mockResolvedValue(undefined)
  m.storage = new InMemoryStore()
  m.pubsub = new EventEmitterPubSub()
  vi.spyOn((await m.storage.getStore('workflows'))!, 'claimRunOwnership')
  restart()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Copilot background execution and native history', () => {
  it('scopes admission identities to the authenticated actor', async () => {
    m.startJobs = false
    const request: CopilotRequest = {
      command: 'message',
      requestId: crypto.randomUUID(),
      workspaceId: scope.workspaceId,
      model: 'configured/model',
      input: { content: 'Same request ID' },
    }
    const first = await (await executeCopilotCommand(request, scope.actorUserId)).json()
    const second = await (await executeCopilotCommand(request, 'another-actor')).json()
    expect(first.status).toBe('accepted')
    expect(second.status).toBe('accepted')
    expect(second.runId).not.toBe(first.runId)
    expect(second.threadId).not.toBe(first.threadId)
    expect(m.dispatch).toHaveBeenCalledTimes(2)
  })

  it.each(['local', 'trigger'])(
    'admits and recovers one %s background turn across retries, restart and later turns',
    async (mode) => {
      m.triggerState.mockResolvedValue({ mode })
      vi.stubEnv('REDIS_URL', 'redis://shared-streams.invalid')
      m.startJobs = false
      setModel({ text: 'Worker answer' }, { text: 'Successor answer' })
      const request: CopilotRequest = {
        command: 'message',
        requestId: crypto.randomUUID(),
        workspaceId: scope.workspaceId,
        model: 'configured/model',
        input: { content: 'Run outside the request' },
      }
      const responses = await Promise.all([
        executeCopilotCommand(request, scope.actorUserId),
        executeCopilotCommand(request, scope.actorUserId),
      ])
      expect(responses.map((response) => response.status)).toEqual([202, 202])
      const accepted = await responses[0].json()
      expect(await responses[1].json()).toEqual(accepted)
      expect(accepted.status).toBe('accepted')
      expect(m.dispatch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ executionType: 'copilot' }),
        mode
      )
      expect(m.contacts).toEqual([])
      expect(m.admit).not.toHaveBeenCalled()
      const thread = await m.memory.getThreadById({ threadId: accepted.threadId })
      const job = thread!.metadata!.copilotJob as { id: string; runId: string }
      expect(job.runId).toBe(accepted.runId)
      expect(JSON.stringify(m.jobs.get(job.id))).not.toContain('admin-key')
      expect(await readCopilotThreadRun(scope, accepted.threadId)).toBe(accepted.runId)
      expect((await message({ threadId: accepted.threadId })).response.status).toBe(409)
      expect(
        (await command({ command: 'thread.delete', threadId: accepted.threadId })).response.status
      ).toBe(409)
      const admission = await readCopilotThreadOwnership(scope, accepted.threadId)
      if (mode === 'local') expect(admission).toMatchObject({ live: true, ownerId: accepted.runId })
      restart()
      const observation = await executeCopilotCommand(
        { command: 'thread.observe', workspaceId: scope.workspaceId, threadId: accepted.threadId },
        scope.actorUserId
      )
      const observer = readEvents(observation.body!)
      try {
        const history = (await observer.next()).value
        expect(history).toMatchObject({ type: 'thread.history', activeRunId: accepted.runId })
        expect(history).not.toHaveProperty('interruptedRunId')
        expect(history).not.toHaveProperty('error')
      } finally {
        await observer.return(undefined)
      }
      await executeJob(job.id)
      expect(
        (await readCopilotThreadOwnership(scope, accepted.threadId))!.generation
      ).toBeGreaterThan(admission!.generation)
      expect(m.contacts).toHaveLength(1)
      const saved = await (await m.storage.getStore('memory'))!.listMessages({
        threadId: accepted.threadId,
        perPage: false,
      })
      expect(saved.messages.filter(({ role }) => role === 'user')).toHaveLength(1)
      const { prompt } = m.contacts[0] as { prompt: { role: string }[] }
      expect(prompt.filter(({ role }) => role === 'user')).toHaveLength(1)
      expect(m.accept).toHaveBeenCalledOnce()
      expect(await readCopilotThreadRun(scope, accepted.threadId)).toBeUndefined()
      expect(await (await executeCopilotCommand(request, scope.actorUserId)).json()).toEqual(
        accepted
      )
      m.startJobs = true
      expect((await message({ threadId: accepted.threadId })).result.status).toBe('success')
      expect(await (await executeCopilotCommand(request, scope.actorUserId)).json()).toEqual(
        accepted
      )
      expect(m.dispatch).toHaveBeenCalledTimes(2)
      expect(m.contacts).toHaveLength(2)
      expect(m.accept).toHaveBeenCalledTimes(2)
      expect(
        (
          await executeCopilotCommand(
            { ...request, input: { content: 'Changed' } },
            scope.actorUserId
          )
        ).status
      ).toBe(409)
    }
  )

  it('refuses remote dispatch without shared native stream transport', async () => {
    m.triggerState.mockResolvedValue({ mode: 'trigger' })
    vi.stubEnv('REDIS_URL', '')
    const { response, result } = await message()
    expect(response.status).toBe(503)
    expect(result).toMatchObject({
      status: 'failed',
      error: { message: 'REDIS_URL is required for Copilot streaming across workers' },
    })
    expect(m.dispatch).not.toHaveBeenCalled()
    expect(m.contacts).toEqual([])
    expect(await threadClaims()).toHaveLength(0)
  })

  it.each(['early failure', 'late failure', 'early success'] as const)(
    'honors the admission result after Trigger dispatch (%s)',
    async (timing) => {
      m.triggerState.mockResolvedValue({ mode: 'trigger' })
      vi.stubEnv('REDIS_URL', 'redis://shared-streams.invalid')
      const success = timing === 'early success'
      const failure = 'Trigger acknowledgment was lost'
      m.dispatch.mockImplementationOnce(async (job) => {
        m.jobs.set(job.id, job)
        if (timing !== 'late failure') {
          const waiting = deferred()
          const workflows = (await m.storage.getStore('workflows'))!
          const read = workflows.getRunOwnership.bind(workflows)
          const spy = vi.spyOn(workflows, 'getRunOwnership').mockImplementation(async (input) => {
            const owner = await read(input)
            if (owner?.live && owner.ownerId === job.payload.runId) waiting.resolve()
            return owner
          })
          try {
            m.executions.set(job.id, executeJob(job.id))
            await waiting.promise
          } finally {
            spy.mockRestore()
          }
        }
        if (!success) throw new Error(failure)
        return `trigger-${job.id}`
      })

      setModel({ text: 'Worker answer' })
      const { response, result } = await message()
      expect(response.status).toBe(success ? 202 : 503)
      expect(m.dispatch).toHaveBeenCalledOnce()
      const [
        {
          id,
          payload: { threadId, runId },
        },
      ] = m.dispatch.mock.calls[0]
      const outcome = success
        ? { status: 'success' }
        : { status: 'failed', error: { code: 'GENERATION_FAILED', message: failure } }
      expect(result).toMatchObject(outcome)
      if (timing === 'late failure') await executeJob(id)
      else await m.executions.get(id)

      const count = success ? 1 : 0
      expect.soft(m.resolve).toHaveBeenCalledTimes(count)
      expect.soft(resolveConfiguredModel).toHaveBeenCalledTimes(count)
      expect.soft(m.contacts).toHaveLength(count)
      expect.soft(m.admit).toHaveBeenCalledTimes(count)
      expect.soft(m.accept).toHaveBeenCalledTimes(count)
      expect(m.route).not.toHaveBeenCalled()
      const thread = await m.memory.getThreadById({ threadId })
      expect(thread?.metadata?.copilotJob).toMatchObject({ id, runId, ...outcome })
      expect(await threadClaims()).toHaveLength(0)
    }
  )

  it.each([false, true])(
    'cancels an admitted turn before its worker starts (other instance: %s)',
    async (otherInstance) => {
      m.startJobs = false
      setModel({ text: 'Next turn' })
      const response = await executeCopilotCommand(
        {
          command: 'message',
          requestId: crypto.randomUUID(),
          workspaceId: scope.workspaceId,
          model: 'configured/model',
          input: { content: 'Cancel before execution' },
        },
        scope.actorUserId
      )
      const accepted = await response.json()
      expect(accepted.status).toBe('accepted')
      const thread = await m.memory.getThreadById({ threadId: accepted.threadId })
      const job = thread!.metadata!.copilotJob as { id: string }
      if (otherInstance) restart()
      expect(
        (await command({ command: 'cancel', threadId: accepted.threadId, runId: accepted.runId }))
          .result
      ).toMatchObject({ status: 'cancel_requested' })
      expect(await readCopilotThreadRun(scope, accepted.threadId)).toBeUndefined()
      await executeJob(job.id)
      expect(m.contacts).toEqual([])
      expect(m.accept).not.toHaveBeenCalled()
      m.startJobs = true
      expect((await message({ threadId: accepted.threadId })).result).toMatchObject({
        status: 'success',
        text: 'Next turn',
      })
    }
  )

  it('does not let a delayed local worker take over a successor generation', async () => {
    m.startJobs = false
    setModel({ text: 'Must not run' })
    const response = await executeCopilotCommand(
      {
        command: 'message',
        requestId: crypto.randomUUID(),
        workspaceId: scope.workspaceId,
        model: 'configured/model',
        input: { content: 'Delayed local dispatch' },
      },
      scope.actorUserId
    )
    const accepted = await response.json()
    const thread = await m.memory.getThreadById({ threadId: accepted.threadId })
    const job = thread!.metadata!.copilotJob as { id: string }
    const admission = (await readCopilotThreadOwnership(scope, accepted.threadId))!
    expect(admission.live).toBe(true)
    restart()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    let successor: Awaited<ReturnType<typeof claimCopilotThread>> | undefined
    try {
      vi.setSystemTime(admission.leaseExpiresAt!.getTime() + 1)
      successor = await claimCopilotThread(scope, accepted.threadId, 'successor-run')
      const before = await readCopilotThreadOwnership(scope, accepted.threadId)
      await expect(executeCopilotJob(m.jobs.get(job.id)!.payload)).rejects.toMatchObject({
        status: 409,
      })
      expect(await readCopilotThreadOwnership(scope, accepted.threadId)).toEqual(before)
      expect(m.contacts).toEqual([])
      expect(m.accept).not.toHaveBeenCalled()
    } finally {
      await successor?.release()
      vi.useRealTimers()
    }
  })

  it.each(['message', 'thread.delete'] as const)(
    'clears a crashed unfinished job before %s without requiring an observer',
    async (operation) => {
      setModel(
        { tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } },
        { text: 'New response' }
      )
      const initial = suspended((await message({ accessLevel: 'limited' })).result)
      const store = (await m.storage.getStore('memory'))!
      const thread = (await store.getThreadById({ threadId: initial.threadId }))!
      await store.updateThread({
        id: initial.threadId,
        metadata: {
          ...thread.metadata,
          copilotJob: {
            ...(thread.metadata!.copilotJob as Record<string, unknown>),
            status: undefined,
          },
        },
      })
      restart()
      const result =
        operation === 'message'
          ? (await message({ threadId: initial.threadId })).result
          : (await command({ command: operation, threadId: initial.threadId })).result
      expect(result).toMatchObject({ status: operation === 'message' ? 'success' : 'updated' })
      expect(
        await (await m.storage.getStore('workflows'))!.getWorkflowRunById({ runId: initial.runId })
      ).toBeNull()
      expect(m.route).not.toHaveBeenCalled()
    }
  )

  it('settles contacted usage after cancellation and a successor without admitting more work', async () => {
    setModel({ text: 'Completed answer' })
    const initial = (await message()).result
    if (initial.status !== 'success') throw new Error(JSON.stringify(initial))
    const thread = (await m.memory.getThreadById({ threadId: initial.threadId }))!
    const job = thread.metadata!.copilotJob as { id: string }
    const identity = {
      ...scope,
      threadId: initial.threadId,
      runId: initial.runId,
      jobId: job.id,
      model: 'configured/model',
    }
    await cancelCopilotRun({ scope, threadId: initial.threadId, runId: initial.runId })
    await (await m.storage.getStore('memory'))!.updateThread({
      id: initial.threadId,
      metadata: {
        ...thread.metadata,
        copilotJob: { id: 'successor', runId: 'successor', status: 'success' },
      },
    })
    const fence = { runId: 'expired-owner', ownerId: initial.runId, generation: 1 }
    const count = m.accept.mock.calls.length
    await handleCopilotWorkerOperation(identity, 'usage.record', {
      attemptId: `${initial.runId}:delayed-attempt:0:0`,
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    })
    expect(m.accept).toHaveBeenCalledTimes(count + 1)
    expect(m.accept).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: initial.runId,
        actorUserId: scope.actorUserId,
        workspaceId: scope.workspaceId,
      }),
      { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      expect.any(Object),
      `${initial.runId}:delayed-attempt:0:0`
    )
    await expect(
      handleCopilotWorkerOperation(identity, 'usage.allow', { fence })
    ).rejects.toMatchObject({ status: 409 })
  })

  it.each(['new', 'edit'])(
    'retains the accepted %s input when worker credentials disappear before native streaming',
    async (kind) => {
      const contexts = [{ kind: 'docs' as const, label: 'Docs' }]
      let editing: { threadId: string; messageId: string } | undefined
      if (kind === 'edit') {
        setModel({ text: 'Previous answer' })
        const initial = (await message({ input: { content: 'Previous prompt', contexts } })).result
        if (initial.status !== 'success') throw new Error(JSON.stringify(initial))
        const stored = await (await m.storage.getStore('memory'))!.listMessages({
          threadId: initial.threadId,
          perPage: false,
        })
        editing = { threadId: initial.threadId, messageId: stored.messages[0].id }
        m.contacts.length = 0
      }
      m.startJobs = false
      setModel({ text: 'Must not run' })
      const text = 'Use the current managed credential'
      const image = {
        type: 'image' as const,
        image: 'data:image/png;base64,aGVsbG8=',
        mediaType: 'image/png',
      }
      const response = await executeCopilotCommand(
        {
          command: 'message',
          requestId: crypto.randomUUID(),
          ...editing,
          workspaceId: scope.workspaceId,
          model: 'configured/model',
          input: { content: kind === 'edit' ? text : [{ type: 'text', text }, image], contexts },
        },
        scope.actorUserId
      )
      const accepted = await response.json()
      expect(accepted.status).toBe('accepted')
      const thread = await m.memory.getThreadById({ threadId: accepted.threadId })
      const job = thread!.metadata!.copilotJob as { id: string }
      const queued = m.jobs.get(job.id)!.payload
      expect(queued).toMatchObject({ messageId: accepted.messageId })
      expect(queued.request).not.toHaveProperty('input')
      expect(JSON.stringify(queued)).not.toContain(image.image)
      const expectedInput = {
        id: accepted.messageId,
        role: 'user',
        parts: [
          { type: 'text', text },
          ...(kind === 'edit'
            ? []
            : [{ type: 'file', data: image.image, mimeType: image.mediaType }]),
          { type: COPILOT_CONTEXT_PART, data: contexts },
        ],
      }
      expect(
        (await command({ command: 'thread.observe', threadId: accepted.threadId })).result
      ).toMatchObject({ items: [expectedInput] })
      m.resolve.mockRejectedValue(new NativeTargetError('Managed credential was removed', 409))
      await executeJob(job.id)
      const current = await m.memory.getThreadById({ threadId: accepted.threadId })
      expect(current!.metadata!.copilotJob).toMatchObject({
        status: 'failed',
        error: { code: 'STALE_TARGET', message: 'Managed credential was removed' },
      })
      expect(m.contacts).toEqual([])
      expect(await readCopilotThreadRun(scope, accepted.threadId)).toBeUndefined()
      restart()
      const observation = await executeCopilotCommand(
        { command: 'thread.observe', workspaceId: scope.workspaceId, threadId: accepted.threadId },
        scope.actorUserId
      )
      const events = readEvents(observation.body!)
      try {
        expect((await events.next()).value).toMatchObject({
          type: 'thread.history',
          activeRunId: null,
          error: { message: 'Managed credential was removed' },
          result: { items: [expectedInput] },
        })
      } finally {
        await events.return(undefined)
      }
    }
  )

  it.each(['Stop', 'ownership loss'])(
    'renews a live preflight beyond lease expiry and prevents inference after %s',
    async (interruption) => {
      const threadId = crypto.randomUUID()
      await m.memory.createThread({ threadId, ...nativeConversationIdentity(scope) })
      const workflows = (await m.storage.getStore('workflows'))!
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      setModel({ text: 'Must not run' })
      const preparing = deferred()
      const release = deferred()
      let generationSignal!: AbortSignal
      m.contexts.mockImplementationOnce(async (...args) => {
        generationSignal = args.at(-1).signal
        preparing.resolve()
        await release.promise
        return []
      })
      const request = new AbortController()
      const response = await executeCopilotCommand(
        {
          command: 'message',
          requestId: crypto.randomUUID(),
          workspaceId: scope.workspaceId,
          threadId,
          model: 'configured/model',
          input: {
            content: 'Stop before acceptance',
            contexts: [{ kind: 'docs', label: 'Docs' }],
          },
        },
        scope.actorUserId,
        request.signal
      )
      const accepted = await response.json()
      await preparing.promise
      const owner = (await readCopilotThreadOwnership(scope, threadId))!
      await vi.advanceTimersByTimeAsync(16_000)
      expect(await readCopilotThreadOwnership(scope, threadId)).toMatchObject({
        ownerId: owner.ownerId,
        live: true,
      })
      const observation = await executeCopilotCommand(
        { command: 'thread.observe', workspaceId: scope.workspaceId, threadId },
        scope.actorUserId
      )
      const observer = readEvents<CopilotThreadEvent>(observation.body!)
      let successor: Awaited<ReturnType<typeof workflows.getRunOwnership>> = null
      let stopping: ReturnType<typeof command> | undefined
      let acknowledged = false
      const abort = vi.spyOn(m.pubsub, 'publish')
      try {
        const event = (await observer.next()).value
        expect(event).toMatchObject({ type: 'thread.history', activeRunId: owner.ownerId })
        expect(event).not.toHaveProperty('interruptedRunId')
        expect(m.contacts).toHaveLength(0)
        if (interruption === 'Stop') {
          stopping = command({ command: 'cancel', threadId, runId: accepted.runId }).then(
            (result) => {
              acknowledged = true
              return result
            }
          )
          await vi.waitFor(async () =>
            expect(await isCopilotRunCancelled(accepted.runId)).toBe(true)
          )
          expect(abort).toHaveBeenCalledWith(AGENT_CONTROL_TOPIC(accepted.runId), {
            type: AgentControlEventTypes.ABORT_REQUEST,
            runId: accepted.runId,
            data: {},
          })
          expect(acknowledged).toBe(false)
          expect(await readCopilotThreadOwnership(scope, threadId)).toMatchObject({
            ownerId: owner.ownerId,
            live: true,
          })
          await expect(claimCopilotThread(scope, threadId, 'competing-run')).rejects.toMatchObject({
            status: 409,
          })
        } else {
          const takeover = await workflows.claimRunOwnership({
            runId: owner.runId,
            ownerId: 'successor',
            leaseMs: 15_000,
            force: true,
          })
          expect(takeover.acquired).toBe(true)
          successor = takeover.record
          await vi.advanceTimersByTimeAsync(5_000)
          await vi.waitFor(() => expect(generationSignal.aborted).toBe(true))
        }
        release.resolve()
        if (successor) {
          await Promise.all(m.executions.values())
          expect(await readCopilotThreadOwnership(scope, threadId)).toEqual(successor)
        } else {
          await vi.waitFor(async () =>
            expect((await readCopilotThreadOwnership(scope, threadId))?.live).toBe(false)
          )
        }
        if (stopping) expect((await stopping).result).toMatchObject({ status: 'cancel_requested' })
        expect(m.contacts).toHaveLength(0)
        expect(m.accept).not.toHaveBeenCalled()
        if (interruption === 'Stop') {
          expect(await pending(threadId)).toEqual([])
          setModel({ text: 'Continued after Stop' })
          expect((await message({ threadId })).result).toMatchObject({
            status: 'success',
            text: 'Continued after Stop',
          })
        }
      } finally {
        release.resolve()
        await observer.return(undefined)
        if (successor) await workflows.releaseRunOwnership(successor)
        abort.mockRestore()
        vi.useRealTimers()
      }
    }
  )

  it('bounds an unresponsive native lease renewal', async () => {
    vi.useFakeTimers()
    const workflows = (await m.storage.getStore('workflows'))!
    const ownership = await claimCopilotThread(scope, 'stalled-thread', 'stalled-run')
    const stalled = vi
      .spyOn(workflows, 'renewRunOwnership')
      .mockImplementationOnce(() => new Promise<never>(() => {}))
    try {
      const rejected = expect(ownership.renew()).rejects.toMatchObject({ status: 409 })
      await vi.advanceTimersByTimeAsync(15_001)
      await rejected
      expect(ownership.signal.aborted).toBe(true)
    } finally {
      stalled.mockRestore()
      await ownership.release()
      vi.useRealTimers()
    }
    expect((await readCopilotThreadOwnership(scope, 'stalled-thread'))?.leaseExpiresAt).toBeNull()
  })

  it.each(['initial', 'periodic'] as const)(
    'bounds a stalled Studio tool lease renewal during %s',
    async (phase) => {
      vi.useFakeTimers()
      const threadId = crypto.randomUUID()
      const runId = crypto.randomUUID()
      await m.memory.createThread({
        threadId,
        ...nativeConversationIdentity(scope),
        metadata: { copilotJob: { id: runId, runId } },
      })
      const ownership = await claimCopilotThread(scope, threadId, runId, runId)
      await ownership.handoff()
      const target = {
        threadId,
        runId,
        ...nativeConversationIdentity(scope),
        toolName: 'rename_workflow',
        toolCallId: 'held-tool',
      }
      const args = { entityId: 'workflow', name: 'Changed' }
      const storedRun = vi.spyOn(await import('./context'), 'readCopilotRun').mockResolvedValue({
        scope,
        threadId,
        runId,
        model: 'configured/model',
        accessLevel: 'full',
      })
      const savedCall = vi
        .spyOn(await import('@/lib/copilot/native/target'), 'resolveNativePendingTarget')
        .mockResolvedValue({ target, originalArgs: args, stage: 'result' })
      const workflows = (await m.storage.getStore('workflows'))!
      const renew = workflows.renewRunOwnership.bind(workflows)
      const renewal = deferred()
      const receipt = deferred()
      const entered = deferred()
      let initialRenewed = false
      const stalled = vi.spyOn(workflows, 'renewRunOwnership').mockImplementation(async (args) => {
        if (phase === 'periodic' && !initialRenewed) initialRenewed = true
        else await renewal.promise
        return renew(args)
      })
      let receiptCheck: { mockRestore(): void } | undefined
      let toolSignal: AbortSignal | undefined
      let mutated = false
      m.route.mockImplementationOnce(async (_name, _args, context) => {
        toolSignal = context.signal
        entered.resolve()
        await new Promise((resolve) => setTimeout(resolve, THREAD_LEASE_MS + 1000))
        toolSignal!.throwIfAborted()
        mutated = true
        return {
          success: true,
          entityKind: 'workflow',
          entityId: 'workflow',
          entityName: 'Changed',
          workspaceId: scope.workspaceId,
        }
      })
      let settled = false
      let failure: unknown
      const execution = handleCopilotWorkerOperation(
        { ...scope, threadId, runId, jobId: runId, model: 'configured/model' },
        'tool',
        {
          target,
          stage: 'studio',
          fence: ownership.fence,
        }
      )
        .catch((error) => {
          failure = error
        })
        .finally(() => {
          settled = true
        })
      try {
        if (phase === 'periodic') {
          await entered.promise
          receiptCheck = vi
            .spyOn(await import('./receipts'), 'assertCopilotRunActive')
            .mockReturnValue(receipt.promise)
        }
        await vi.advanceTimersByTimeAsync(THREAD_LEASE_MS - 1)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(2)
        if (phase === 'periodic') expect(toolSignal?.aborted).toBe(true)
        else expect(settled).toBe(true)
        expect(mutated).toBe(false)
        await vi.advanceTimersByTimeAsync(1000)
        expect(mutated).toBe(false)
        expect(settled).toBe(true)
        expect(failure).toMatchObject({ status: 409 })
        renewal.resolve()
        receipt.resolve()
        await vi.advanceTimersByTimeAsync(THREAD_LEASE_MS + 1000)
        expect(m.route).toHaveBeenCalledTimes(phase === 'initial' ? 0 : 1)
        expect(mutated).toBe(false)
      } finally {
        renewal.resolve()
        receipt.resolve()
        await vi.advanceTimersByTimeAsync(THREAD_LEASE_MS + 1000)
        await execution
        storedRun.mockRestore()
        savedCall.mockRestore()
        receiptCheck?.mockRestore()
        stalled.mockRestore()
        await ownership.release()
        vi.useRealTimers()
      }
    }
  )

  it.each(['startup', 'provider'])(
    'redacts a native %s failure and releases the conversation for another message',
    async (phase) => {
      const threadId = crypto.randomUUID()
      await m.memory.createThread({ threadId, ...nativeConversationIdentity(scope) })
      const error = Object.assign(new Error('Native failure: admin-key'), {
        statusCode: 401,
        isRetryable: false,
      })
      setModel(...(phase === 'provider' ? [{ error }] : []), { text: 'Retry succeeded' })
      if (phase === 'startup') vi.spyOn(m.agent, 'getDefaultOptions').mockRejectedValueOnce(error)
      expect((await message({ threadId })).result).toMatchObject({
        status: 'failed',
        error: { code: 'GENERATION_FAILED', message: 'Native failure: [redacted]' },
      })
      expect(m.contacts).toHaveLength(phase === 'provider' ? 1 : 0)
      expect(await readCopilotThreadRun(scope, threadId)).toBeUndefined()
      expect((await message({ threadId })).result).toMatchObject({
        status: 'success',
        threadId,
        text: 'Retry succeeded',
      })
      expect(m.contacts).toHaveLength(phase === 'provider' ? 2 : 1)
      if (phase === 'startup') expect(m.accept).toHaveBeenCalledOnce()
    }
  )

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
        requestId: crypto.randomUUID(),
        workspaceId: scope.workspaceId,
        threadId,
        model: 'configured/model',
        input: { content: 'Keep answering after reload' },
      },
      scope.actorUserId,
      request.signal
    )
    const first = await response.json()
    expect(first.status).toBe('accepted')
    await vi.waitFor(() => expect(m.contacts).toHaveLength(1))
    const originalResponse = await executeCopilotCommand(
      { command: 'thread.observe', workspaceId: scope.workspaceId, threadId },
      scope.actorUserId,
      request.signal
    )
    const original = readEvents(originalResponse.body!)
    while (true) {
      const event = (await original.next()).value
      if (event?.type === 'thread.output' && event.event.type === 'text.delta') break
    }
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
      const { result } = await command({ command: 'thread.observe', threadId })
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

  it.each(['expired before observation', 'expired after preflight', 'released after preflight'])(
    'settles a preflight owner %s and continues the same conversation without replay',
    async (outcome) => {
      const threadId = crypto.randomUUID()
      await m.memory.createThread({ threadId, ...nativeConversationIdentity(scope) })
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      const abandoned = await claimCopilotThread(scope, threadId, 'preflight-run')
      const owner = (await readCopilotThreadOwnership(scope, threadId))!
      if (outcome === 'expired before observation')
        vi.setSystemTime(owner.leaseExpiresAt!.getTime() + 1)
      try {
        const response = await executeCopilotCommand(
          { command: 'thread.observe', workspaceId: scope.workspaceId, threadId },
          scope.actorUserId
        )
        const observer = readEvents<CopilotThreadEvent>(response.body!)
        try {
          let snapshot = (await observer.next()).value
          if (outcome !== 'expired before observation') {
            expect(snapshot).toMatchObject({ type: 'thread.history', activeRunId: 'preflight-run' })
            await observer.return(undefined)
            if (outcome === 'released after preflight') await abandoned.release()
            else vi.setSystemTime(owner.leaseExpiresAt!.getTime() + 1)
            const refreshed = await executeCopilotCommand(
              { command: 'thread.observe', workspaceId: scope.workspaceId, threadId },
              scope.actorUserId
            )
            const reconnected = readEvents<CopilotThreadEvent>(refreshed.body!)
            try {
              snapshot = (await reconnected.next()).value
            } finally {
              await reconnected.return(undefined)
            }
          }
          expect(snapshot).toMatchObject({ type: 'thread.history', activeRunId: null })
          if (outcome === 'released after preflight')
            expect(snapshot).not.toHaveProperty('interruptedRunId')
          else expect(snapshot).toHaveProperty('interruptedRunId', 'preflight-run')
          expect(await readCopilotThreadRun(scope, threadId)).toBeUndefined()
          expect(m.contacts).toHaveLength(0)
          expect(m.accept).not.toHaveBeenCalled()
        } finally {
          await observer.return(undefined)
        }
        setModel({ text: 'Continue here' })
        expect((await message({ threadId })).result).toMatchObject({
          status: 'success',
          threadId,
          text: 'Continue here',
        })
        expect(m.contacts).toHaveLength(1)
        expect(m.accept).toHaveBeenCalledOnce()
        const successor = await readCopilotThreadOwnership(scope, threadId)
        expect(successor!.generation).toBeGreaterThan(owner.generation)
        await expect(abandoned.renew()).rejects.toMatchObject({ status: 409 })
        await abandoned.release()
        expect(await readCopilotThreadOwnership(scope, threadId)).toEqual(successor)
      } finally {
        await abandoned.release()
        vi.useRealTimers()
      }
    }
  )

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
        const response = await executeCopilotCommand(
          {
            command: 'message',
            requestId: crypto.randomUUID(),
            workspaceId: scope.workspaceId,
            model: 'configured/model',
            input: { content: 'Do not generate after cancellation' },
          },
          scope.actorUserId,
          controller.signal
        )
        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({ status: 'failed' })
        expect(m.contacts).toEqual([])
        expect(m.admit).not.toHaveBeenCalled()
        expect(m.accept).not.toHaveBeenCalled()
        expect(await threadClaims()).toHaveLength(0)
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
      expect((await message()).result).toMatchObject({ status: 'failed' })
      expect(m.contacts).toHaveLength(0)
      expect(await threadClaims()).toHaveLength(0)
      expect(m.admit).not.toHaveBeenCalled()
      expect(resolveConfiguredModel).not.toHaveBeenCalled()
    }
  )
  it('retains the next prompt but refuses inference after key removal even when the Agent is warm', async () => {
    setModel({ text: 'Finished before key removal' }, { text: 'Must not run' })
    const initial = (await message()).result
    if (initial.status !== 'success') throw new Error(JSON.stringify(initial))
    const agent = m.agent
    const history = (await command({ command: 'thread.observe', threadId: initial.threadId }))
      .result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    const admissions = m.admit.mock.calls.length
    const charges = m.accept.mock.calls.length
    const models = vi.mocked(resolveConfiguredModel).mock.calls.length
    m.resolve.mockRejectedValue(new NativeTargetError('The Copilot API key is not configured', 409))

    expect((await message({ threadId: initial.threadId })).result).toMatchObject({
      status: 'failed',
      error: { code: 'STALE_TARGET', message: 'The Copilot API key is not configured' },
    })
    expect(m.agent).toBe(agent)
    expect(m.resolve).toHaveBeenCalledTimes(2)
    expect(m.contacts).toHaveLength(1)
    expect(resolveConfiguredModel).toHaveBeenCalledTimes(models)
    expect(m.admit).toHaveBeenCalledTimes(admissions)
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(m.route).not.toHaveBeenCalled()
    expect([...m.receipts.keys()].every((id) => id.startsWith('copilot:admission:'))).toBe(true)
    expect(await threadClaims()).toHaveLength(0)
    expect(
      (await command({ command: 'thread.observe', threadId: initial.threadId })).result
    ).toMatchObject({
      ...history,
      items: [
        ...history.items,
        { role: 'user', parts: [{ type: 'text', text: 'Original request🔥' }] },
      ],
    })
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
    const history = (await command({ command: 'thread.observe', threadId: 'thread-0' })).result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    expect(history.items.map((message) => message.id)).toEqual(
      Array.from({ length: 125 }, (_, i) => `message-${i}`)
    )
  })
  it('persists chat and image history across worker instances before the next turn', async () => {
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
      status: 'success',
      text: 'Known answer🔥',
    })
    if (result.status !== 'success') throw new Error(JSON.stringify(result))
    restart()
    const history = (
      await command({
        command: 'thread.observe',
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
    expect(next).toMatchObject({ status: 'success', text: 'Follow-up answer' })
    expect(JSON.stringify(m.contacts[1])).toContain('Original request🔥')
    expect(m.accept).toHaveBeenCalledTimes(2)
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it.each(['success', 'refused', 'error'] as const)(
    'continues after a server read (%s)',
    async (outcome) => {
      const workspaceId = '550e8400-e29b-41d4-a716-446655440000'
      const failed = outcome !== 'success'
      const text = failed ? 'The lookup failed.' : 'One known workflow'
      setModel({ tool: 'list_workflows', args: { workspaceId } }, { text })
      if (failed)
        m.route.mockRejectedValueOnce(
          outcome === 'refused'
            ? new NativeTargetError('Workflow service unavailable', 404)
            : new Error('Database failure with admin-key')
        )
      else
        m.route.mockResolvedValueOnce({
          entityKind: 'workflow',
          entities: [{ entityId: 'workflow', entityName: 'Known' }],
          count: 1,
        })
      const { result } = await message({ scope: { ...scope, workspaceId }, accessLevel: 'full' })
      expectWorkspaceScope(m.contacts[0], workspaceId)
      expect(result).toMatchObject({
        status: 'success',
        text,
      })
      expect(m.route).toHaveBeenCalledExactlyOnceWith(
        'list_workflows',
        { workspaceId },
        expect.objectContaining({ userId: 'actor', workspaceId })
      )
      expect(m.admit).toHaveBeenCalledTimes(2)
      expect(m.accept).toHaveBeenCalledTimes(2)
      expect(m.contacts).toHaveLength(2)
      if (failed)
        expect(JSON.stringify(m.contacts[1])).toContain(
          outcome === 'refused' ? 'Workflow service unavailable' : 'Server tool execution failed'
        )
      expect(JSON.stringify(m.contacts)).not.toContain('Database failure with admin-key')
      expect(await threadClaims()).toHaveLength(0)
      expect(resolveConfiguredModel).toHaveBeenCalledExactlyOnceWith(
        'configured/model',
        'admin-key'
      )
      expect(m.fetch).not.toHaveBeenCalled()
      if (result.status !== 'success') throw new Error(JSON.stringify(result))
      const history = (
        await command({
          scope: { ...scope, workspaceId },
          command: 'thread.observe',
          threadId: result.threadId,
        })
      ).result
      if (history.status !== 'history') throw new Error(JSON.stringify(history))
      const replies = history.items.filter((item) => item.role === 'assistant')
      expect(sumNativeUsage(replies)).toEqual({ inputTokens: 6, outputTokens: 4, totalTokens: 10 })
      expect(replies.every((item) => item.cost?.status === 'unavailable')).toBe(true)
    }
  )

  it.each([true, false])(
    'drains automatic siblings around a public approval (both reads first: %s)',
    async (readsFirst) => {
      setModel(
        {
          tools: [
            { tool: 'list_workflows', toolCallId: 'read-one', args: { workspaceId: 'workspace' } },
            ...(readsFirst
              ? []
              : [
                  {
                    tool: 'rename_workflow',
                    toolCallId: 'approve',
                    args: { entityId: 'workflow', name: 'Reviewed' },
                  },
                ]),
            {
              tool: 'list_workflows',
              toolCallId: 'read-two',
              args: { workspaceId: 'second-workspace' },
            },
            ...(readsFirst
              ? [
                  {
                    tool: 'rename_workflow',
                    toolCallId: 'approve',
                    args: { entityId: 'workflow', name: 'Reviewed' },
                  },
                ]
              : []),
          ],
        },
        { text: 'Completed both reads.' }
      )
      m.route.mockResolvedValue({ entityKind: 'workflow', entities: [], count: 0 })
      const initial = suspended((await message({ accessLevel: 'limited' })).result)
      expect(initial.pending.map((call) => [call.target.toolCallId, call.stage])).toEqual([
        ['approve', 'approval'],
      ])
      expect(m.route).toHaveBeenCalledTimes(readsFirst ? 2 : 1)
      expect(m.contacts).toHaveLength(1)
      restart()
      const next = await command({ command: 'tool.decline', target: initial.pending[0].target })
      expect(next.result).toMatchObject({ status: 'success', text: 'Completed both reads.' })
      expect(m.contacts).toHaveLength(2)
      expect(m.accept).toHaveBeenCalledTimes(2)
      expect(m.route).toHaveBeenCalledTimes(2)
    }
  )

  it('continues after the search tool finds no configured service credentials', async () => {
    const services = await import('@/lib/system-services/runtime')
    const exa = vi
      .spyOn(services, 'resolveExaServiceConfig')
      .mockResolvedValueOnce({ apiKey: null })
    const serper = vi
      .spyOn(services, 'resolveSerperServiceConfig')
      .mockResolvedValueOnce({ apiKey: null })
    try {
      const { searchOnlineServerTool } = await import(
        '@/lib/copilot/tools/server/other/search-online'
      )
      m.route.mockImplementationOnce((_name, args, context) =>
        searchOnlineServerTool.execute(args, context)
      )
      setModel(
        { tool: 'search_online', args: { query: 'Studio documentation' } },
        { text: 'Search is unavailable.' }
      )
      expect((await message({ accessLevel: 'full' })).result).toMatchObject({
        status: 'success',
        text: 'Search is unavailable.',
      })
      expect(JSON.stringify(m.contacts[1])).toContain('Server tool execution failed')
      expect(m.contacts).toHaveLength(2)
      expect(m.accept).toHaveBeenCalledTimes(2)
      expect(m.fetch).not.toHaveBeenCalled()
      expect(await threadClaims()).toHaveLength(0)
    } finally {
      exa.mockRestore()
      serper.mockRestore()
    }
  }, 30_000)

  it('identifies a personal conversation without inventing a selected workspace', async () => {
    setModel({ text: 'Select a workspace to list its workflows.' })
    const { result } = await message({ scope: { ...scope, workspaceId: null } })
    expect(result.status).toBe('success')
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
    expect(await threadClaims()).toHaveLength(0)
  }, 30_000)

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
      status: 'success',
      text: 'No workflows are available.',
      usage: { inputTokens: 150, outputTokens: 100, totalTokens: 250 },
    })
    expect(m.contacts).toHaveLength(50)
    expect(m.contacts.at(-1)).toMatchObject({ toolChoice: { type: 'none' } })
    expect(m.route).toHaveBeenCalledTimes(49)
    expect(m.accept).toHaveBeenCalledTimes(50)
    expect(await threadClaims()).toHaveLength(0)
  }, 30_000)

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
    expect(await threadClaims()).toHaveLength(0)
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
    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error(JSON.stringify(result))
    expect(JSON.stringify(m.contacts[0])).toContain(privateContext)
    expect(JSON.stringify(m.contacts[0])).toContain('Explain @My workflow')
    const history = (
      await command({
        command: 'thread.observe',
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
    ).toBe('success')
    expect(JSON.stringify(m.contacts[1])).toContain('Edited @My workflow')
    expect(JSON.stringify(m.contacts[1])).not.toContain('Initial answer')
    const edited = (await command({ command: 'thread.observe', threadId: result.threadId })).result
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
    ).toBe('success')
    expect(JSON.stringify(m.contacts[2])).toContain('Edited @My workflow')
    expect(JSON.stringify(m.contacts[2])).toContain(context.workflowId)
    expect(JSON.stringify(m.contacts[2])).not.toContain(privateContext)
  })

  it.each(['limited', 'full'])(
    'persists planning tools through native execution without browser continuation in %s mode',
    async (accessLevel) => {
      const { routeExecution } = await vi.importActual<
        typeof import('@/lib/copilot/tools/server/router')
      >('@/lib/copilot/tools/server/router')
      m.route.mockImplementation(routeExecution)
      const steps = [
        { tool: 'plan', args: { todoList: [{ id: 'todo', content: 'Inspect workflow' }] } },
        { tool: 'mark_todo_in_progress', args: { id: 'todo' } },
        { tool: 'checkoff_todo', args: { id: 'todo' } },
      ]
      setModel(...steps.map((step) => ({ ...step, toolCallId: step.tool })), { text: 'Done' })
      const { result } = await message({ accessLevel })
      expect(result).toMatchObject({ status: 'success', text: 'Done' })
      if (result.status !== 'success') throw new Error(JSON.stringify(result))
      expect(m.route).toHaveBeenCalledTimes(3)
      restart()
      const { result: history } = await command({
        command: 'thread.observe',
        threadId: result.threadId,
      })
      if (history.status !== 'history') throw new Error(JSON.stringify(history))
      expect(history.pending).toEqual([])
      expect(history.items.flatMap((item) => item.parts)).toEqual(
        expect.arrayContaining(
          steps.map(({ tool, args }) =>
            expect.objectContaining({
              type: 'tool-invocation',
              toolInvocation: expect.objectContaining({
                toolName: tool,
                state: 'result',
                result: args,
              }),
            })
          )
        )
      )
    },
    15_000
  )

  it('streams queued server-tool continuation through the native thread subscription', async () => {
    setModel(
      { tool: 'list_workflows', args: { workspaceId: 'workspace' } },
      { text: 'Known workflows' }
    )
    const executing = deferred()
    const finish = deferred()
    m.route.mockImplementationOnce(async () => {
      executing.resolve()
      await finish.promise
      return { entityKind: 'workflow', entities: [], count: 0 }
    })
    const response = await executeCopilotCommand(
      {
        workspaceId: scope.workspaceId,
        command: 'message',
        requestId: crypto.randomUUID(),
        model: 'configured/model',
        input: { content: 'List workflows' },
        accessLevel: 'full',
      },
      scope.actorUserId
    )
    expect(response.status).toBe(202)
    const accepted = await response.json()
    await executing.promise
    const attempted = await executeCopilotCommand(
      {
        command: 'tool.execute',
        workspaceId: scope.workspaceId,
        requestId: crypto.randomUUID(),
        action: 'readback',
        target: {
          threadId: accepted.threadId,
          runId: accepted.runId,
          ...nativeConversationIdentity(scope),
          toolCallId: 'original-tool-call',
          toolName: 'list_workflows',
        },
      },
      scope.actorUserId
    )
    expect(attempted.status).toBe(409)
    const observation = await executeCopilotCommand(
      { command: 'thread.observe', workspaceId: scope.workspaceId, threadId: accepted.threadId },
      scope.actorUserId
    )
    const events: CopilotThreadEvent[] = []
    try {
      for await (const event of readEvents(observation.body!)) {
        events.push(event)
        if (event.type === 'thread.history') {
          expect(event.result.pending).toEqual([])
          expect(JSON.stringify(event.result.items)).not.toContain('studioDispatch')
          finish.resolve()
        }
        if (event.type === 'thread.status') break
      }
    } finally {
      finish.resolve()
    }
    expect(events[0]).toMatchObject({ type: 'thread.history', activeRunId: accepted.runId })
    const output = events.flatMap((event) => (event.type === 'thread.output' ? [event.event] : []))
    expect(output.map((event) => event.type)).toContain('text.delta')
    expect(output.find((event) => event.type === 'tool.result')).toMatchObject({
      type: 'tool.result',
      toolName: 'list_workflows',
      result: { entityKind: 'workflow', entities: [], count: 0 },
    })
    expect(events.at(-1)).toMatchObject({ type: 'thread.status', status: 'success' })
    expect(JSON.stringify(events)).not.toContain('admin-key')
    expect(m.fetch).not.toHaveBeenCalled()
  })

  it('keeps the native result pending when the accepted readback finds a resumed checkpoint', async () => {
    const workflowId = 'reviewed-workflow'
    setModel(
      { tool: 'run_workflow', args: { entityId: workflowId, triggerBlockId: 'trigger' } },
      { text: 'Received the final cancellation' }
    )
    const initial = suspended(
      (
        await message({
          accessLevel: 'full',
          toolContext: {
            contextEntityKind: 'workflow',
            contextEntityId: workflowId,
            workspaceId: 'business',
          },
        })
      ).result
    )
    const target = initial.pending[0].target
    const executionId = nativeToolCallId(target)
    const handle = { workflowId, executionId, taskId: executionId }
    const request = {
      command: 'tool.execute',
      action: 'readback',
      target,
      workspaceId: scope.workspaceId,
      requestId: crypto.randomUUID(),
    } as const
    m.startJobs = false
    expect((await executeCopilotCommand(request, scope.actorUserId)).status).toBe(202)
    expect(m.executionLog).not.toHaveBeenCalled()
    m.executionLog.mockRejectedValueOnce(new ObserveResumedWorkflow(handle))
    await executeJob([...m.jobs.keys()][0])
    restart()
    const { result: history } = await command({
      command: 'thread.observe',
      threadId: initial.threadId,
    })
    if (history.status !== 'history') throw new Error('Missing persisted history')
    expect(history).toMatchObject({
      pending: initial.pending,
      workflowObservation: {
        requestId: request.requestId,
        nextRequestId: expect.any(String),
        target,
        handle,
      },
    })
    expect(m.contacts).toHaveLength(1)
    expect(m.accept).toHaveBeenCalledTimes(1)
    m.executionLog.mockResolvedValue({
      executionId,
      level: 'error',
      startedAt: new Date(),
      endedAt: new Date(),
      totalDurationMs: 1,
      executionData: { errorMessage: 'Workflow execution was cancelled' },
    })
    m.startJobs = true
    const final = { ...request, requestId: history.workflowObservation!.nextRequestId }
    expect((await command(final)).result.status).toBe('success')
    expect(JSON.stringify(m.contacts[1])).toContain('Workflow execution was cancelled')
    expect((await command(final)).result.status).toBe('success')
    expect(m.contacts).toHaveLength(2)
    expect(await pending(initial.threadId)).toEqual([])
  })
  it.each(['info', 'error'])(
    'resumes a retained %s workflow result after deletion without live-workflow admission',
    async (level) => {
      const workflowId = 'deleted-workflow'
      setModel(
        { tool: 'run_workflow', args: { entityId: workflowId, triggerBlockId: 'trigger' } },
        { text: 'Recovered execution result' }
      )
      const toolContext = {
        contextEntityKind: 'workflow',
        contextEntityId: workflowId,
        workspaceId: 'execution-workspace',
      }
      const initial = suspended((await message({ toolContext, accessLevel: 'full' })).result)
      const target = initial.pending[0].target
      const output = { retained: 'Original workflow output' }
      m.executionLog.mockResolvedValue({
        id: 'retained-log',
        executionId: nativeToolCallId(target),
        workflowId: null,
        workflowSummary: { id: workflowId },
        workspaceId: toolContext.workspaceId,
        level,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        endedAt: new Date('2026-01-01T00:00:01Z'),
        totalDurationMs: 1000,
        executionData: {
          environment: { userId: scope.actorUserId, workspaceId: toolContext.workspaceId },
          finalOutput: output,
          ...(level === 'error' ? { errorMessage: 'Workflow failed' } : {}),
        },
      })
      m.business.mockClear().mockImplementation(async (_scope, _pending, result) => {
        if (result === undefined) throw new NativeTargetError('Workflow no longer exists', 403)
      })
      restart()
      const { result } = await command({
        command: 'tool.execute',
        target,
        action: 'readback',
      })
      expect(result).toMatchObject({ status: 'success', text: 'Recovered execution result' })
      expect(m.business).not.toHaveBeenCalled()
      expect(m.executionLog).toHaveBeenCalledExactlyOnceWith(
        scope,
        expect.objectContaining({ target }),
        expect.objectContaining({ userId: scope.actorUserId })
      )
      expect(JSON.stringify(m.contacts[1])).toContain(output.retained)
      for (const calls of [m.admit.mock.calls, m.accept.mock.calls]) {
        expect(calls).toHaveLength(2)
        for (const [usageScope] of calls) {
          expect(usageScope.workspaceId).toBe(scope.workspaceId)
          expect(usageScope.workflowId).toBeUndefined()
        }
      }
      expect(m.route).not.toHaveBeenCalled()
      expect(await pending(initial.threadId)).toEqual([])
    }
  )

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
      expect(result).toMatchObject({ status: 'success', text: 'Drive files are available' })
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
      if (initial.status !== 'success') throw new Error(JSON.stringify(initial))
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
      expect(await threadClaims()).toHaveLength(0)
    }
  )

  it('does not replay a suspended terminal status while its continuation awaits a worker', async () => {
    setModel(
      { tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } },
      { text: 'Approved answer' }
    )
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    m.startJobs = false
    m.route.mockResolvedValue({
      success: true,
      entityKind: 'workflow',
      entityId: 'workflow',
      entityName: 'Changed',
      workspaceId: scope.workspaceId,
    })
    const response = await executeCopilotCommand(
      {
        command: 'tool.approve',
        requestId: crypto.randomUUID(),
        workspaceId: scope.workspaceId,
        target: initial.pending[0].target,
      },
      scope.actorUserId
    )
    const accepted = await response.json()
    expect(accepted).toMatchObject({ status: 'accepted', runId: initial.runId })
    const thread = await m.memory.getThreadById({ threadId: initial.threadId })
    const job = thread!.metadata!.copilotJob as { id: string }
    const cancellation = new AbortController()
    const observation = await executeCopilotCommand(
      { command: 'thread.observe', workspaceId: scope.workspaceId, threadId: initial.threadId },
      scope.actorUserId,
      cancellation.signal
    )
    const events: CopilotThreadEvent[] = []
    const terminal = (async () => {
      for await (const event of readEvents(observation.body!)) {
        events.push(event)
        if (event.type === 'thread.status') return event
      }
    })()
    try {
      await vi.waitFor(() =>
        expect(events[0]).toMatchObject({ type: 'thread.history', activeRunId: initial.runId })
      )
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(events.some((event) => event.type === 'thread.status')).toBe(false)
      expect(m.route).not.toHaveBeenCalled()
      await executeJob(job.id)
      expect(await terminal).toMatchObject({
        type: 'thread.status',
        status: 'success',
        runId: initial.runId,
        history: { pending: [] },
      })
      expect(m.route).toHaveBeenCalledOnce()
    } finally {
      cancellation.abort()
      await terminal
    }
  })

  it('recovers the original preview after restart and applies a decision once', async () => {
    const originalCredential = 'first-synthetic-credential'
    const rotatedCredential = 'replacement-synthetic-credential'
    const reasoning = { type: 'effort', value: 'high' } as const
    const providerOptions = { openai: { reasoningEffort: 'high' } }
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
          model: 'openai/gpt-5',
          reasoning,
          input: { content: 'Rename the workflow', contexts: [context] },
        })
      ).result
    )
    expect(initial.pending[0].stage).toBe('approval')
    expect(m.contacts[0]).toMatchObject({ providerOptions })
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
      model: 'openai/gpt-5',
      accessLevel: 'limited',
      reasoning,
    })
    await expect(
      readCopilotRun({ ...scope, actorUserId: 'foreign' }, initial.threadId, initial.runId)
    ).rejects.toMatchObject({ status: 403 })
    await expect(readCopilotRun(scope, 'another-thread', initial.runId)).rejects.toMatchObject({
      status: 403,
    })
    const approval = {
      command: 'tool.approve',
      requestId: crypto.randomUUID(),
      target: initial.pending[0].target,
    }
    const approved = suspended((await command(approval)).result)
    expect((await command(approval)).result).toMatchObject(approved)
    expect(m.resolve).toHaveBeenLastCalledWith('openai/gpt-5', reasoning)
    expect(resolveConfiguredModel).toHaveBeenLastCalledWith('openai/gpt-5', rotatedCredential)
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
    ).toMatchObject({ status: 'failed', error: { code: 'FORBIDDEN' } })
    expect(m.route).toHaveBeenCalledOnce()
    const decision = {
      command: 'tool.execute',
      requestId: crypto.randomUUID(),
      target: approved.pending[0].target,
      action: 'review.accept',
    }
    expect((await command(decision)).result).toMatchObject({
      status: 'success',
      text: 'Renamed successfully',
    })
    expect(m.route).toHaveBeenCalledTimes(2)
    expectWorkspaceScope(m.contacts[1], scope.workspaceId)
    expect(m.contacts[1]).toMatchObject({ providerOptions })
    expect(JSON.stringify(m.contacts[1])).toContain(privateContext)
    expect(m.route).toHaveBeenLastCalledWith(
      'rename_workflow',
      args,
      expect.objectContaining({ accessLevel: 'full', acceptedReviewBaseStateHash: 'original-base' })
    )
    const history = (await command({ command: 'thread.observe', threadId: initial.threadId }))
      .result
    if (history.status !== 'history') throw new Error(JSON.stringify(history))
    const assistants = history.items.filter((item) => item.role === 'assistant')
    expect(assistants).toHaveLength(2)
    for (const assistant of assistants) {
      expect(assistant.runId).toBe(initial.runId)
      expect(assistant.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 })
      expect(assistant.cost).toMatchObject({ status: 'estimated', currency: 'USD' })
      expect(assistant.cost?.total).toBeCloseTo(0.00002375, 12)
    }
    const contacts = m.contacts.length
    const settlements = m.accept.mock.calls.length
    expect((await command(approval)).result).toMatchObject({ status: 'success' })
    expect((await command(decision)).result).toMatchObject({ status: 'success' })
    expect(m.route).toHaveBeenCalledTimes(2)
    expect(m.contacts).toHaveLength(contacts)
    expect(m.accept).toHaveBeenCalledTimes(settlements)
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
      const reasoning = { type: 'effort', value: 'high' } as const
      const initial = suspended(
        (await message({ toolContext, accessLevel: 'limited', model: 'openai/gpt-5', reasoning }))
          .result
      )
      const expected = toolContext ?? { workspaceId: scope.workspaceId }
      expect(initial.pending[0]).toMatchObject({ stage: 'approval', context: expected })
      restart()
      expect(await pending(initial.threadId)).toEqual(initial.pending)
      const resumed = suspended(
        (
          await command({
            command: 'tool.approve',
            target: initial.pending[0].target,
          })
        ).result
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
      ).toMatchObject({ status: 'success', text: 'Done' })
      expect(m.contacts).toHaveLength(3)
      for (const contact of m.contacts)
        expect(contact).toMatchObject({ providerOptions: { openai: { reasoningEffort: 'high' } } })
    }
  )

  it('retains the admitted reasoning effort on cold decline', async () => {
    const reasoning = { type: 'effort', value: 'low' } as const
    setModel(
      { tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } },
      { text: 'No edit applied' }
    )
    const initial = suspended(
      (await message({ accessLevel: 'limited', model: 'openai/gpt-5', reasoning })).result
    )
    restart()
    const { result } = await command({
      command: 'tool.decline',
      target: initial.pending[0].target,
      reason: 'Declined',
    })
    expect(result).toMatchObject({ status: 'success', text: 'No edit applied' })
    expect(m.route).not.toHaveBeenCalled()
    expect(m.contacts).toHaveLength(2)
    for (const contact of m.contacts)
      expect(contact).toMatchObject({ providerOptions: { openai: { reasoningEffort: 'low' } } })
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
      expect(result.result).toMatchObject({ status: 'success', text: 'No edit applied' })
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
          command: 'thread.observe',
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

  it.each(
    ['local', 'trigger'].flatMap((mode) =>
      [
        { command: 'tool.approve', requestId: crypto.randomUUID() },
        { command: 'tool.decline', requestId: crypto.randomUUID(), reason: 'Declined' },
        { command: 'tool.execute', requestId: crypto.randomUUID(), action: 'readback' },
        {
          command: 'tool.result',
          requestId: crypto.randomUUID(),
          assertion: { kind: 'timer.completed', data: {} },
        },
      ].map((request) => ({ mode, request }))
    )
  )(
    'rejects a foreign run before $request.command admission ($mode)',
    async ({ mode, request }) => {
      const victimScope = { ...scope, actorUserId: 'victim-actor' }
      setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
      const victim = suspended(
        (await message({ scope: victimScope, accessLevel: 'limited' })).result
      )
      const threadId = crypto.randomUUID()
      await m.memory.createThread({ threadId, ...nativeConversationIdentity(scope) })
      const workflows = (await m.storage.getStore('workflows'))!
      const snapshot = await workflows.getWorkflowRunById({ runId: victim.runId })
      const victimThread = structuredClone(
        await m.memory.getThreadById({ threadId: victim.threadId })
      )
      const victimOwner = structuredClone(
        await readCopilotThreadOwnership(victimScope, victim.threadId)
      )
      const ownThread = structuredClone(await m.memory.getThreadById({ threadId }))
      const receipts = new Map(m.receipts)
      m.startJobs = false
      m.triggerState.mockResolvedValue({ mode })
      vi.stubEnv('REDIS_URL', 'redis://shared-streams.invalid')
      m.dispatch.mockClear()
      const response = await executeCopilotCommand(
        {
          ...request,
          workspaceId: scope.workspaceId,
          target: {
            ...victim.pending[0].target,
            threadId,
            resourceId: nativeConversationIdentity(scope).resourceId,
          },
        } as CopilotRequest,
        scope.actorUserId
      )
      await executeCopilotCommand(
        { command: 'cancel', workspaceId: scope.workspaceId, threadId, runId: victim.runId },
        scope.actorUserId
      )
      expect(await isCopilotRunCancelled(victim.runId)).toBe(false)
      expect(m.receipts).toEqual(receipts)
      expect(await workflows.getWorkflowRunById({ runId: victim.runId })).toEqual(snapshot)
      expect(await m.memory.getThreadById({ threadId: victim.threadId })).toEqual(victimThread)
      expect(await readCopilotThreadOwnership(victimScope, victim.threadId)).toEqual(victimOwner)
      expect(await m.memory.getThreadById({ threadId })).toEqual(ownThread)
      expect(await readCopilotThreadOwnership(scope, threadId)).toBeNull()
      expect(m.dispatch).not.toHaveBeenCalled()
      expect(m.jobs.size).toBe(0)
      expect(m.contacts).toHaveLength(1)
      expect(response.status).toBe(409)
    }
  )

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
      (
        await command({
          command: 'tool.approve',
          target: original.target,
        })
      ).result
    ).toMatchObject({ status: 'refused' })
    expect(m.route).not.toHaveBeenCalled()
    expect(m.contacts).toHaveLength(1)
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(await threadClaims()).toHaveLength(0)
  })

  it('uses one native preflight without polling while generation runs or after browser suspension', async () => {
    setModel({ tool: 'sleep', args: { seconds: 1 } }, { text: 'Continued answer' })
    const entered = deferred()
    const finish = deferred()
    const generate = m.model.doStream.bind(m.model)
    const provider = vi.spyOn(m.model, 'doStream').mockImplementation(async (input) => {
      entered.resolve()
      await finish.promise
      return generate(input)
    })
    const operations: string[] = []
    const nativeFetch = globalThis.fetch
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      operations.push((await request.clone().json()).operation)
      return nativeFetch(input, init)
    })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const responding = message({ accessLevel: 'full' })
    try {
      await entered.promise
      expect(operations.filter((operation) => operation === 'active')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(operations.filter((operation) => operation === 'active')).toHaveLength(1)
      finish.resolve()
      const initial = suspended((await responding).result)
      expect((await readCopilotThreadOwnership(scope, initial.threadId))?.live).toBe(false)
      await vi.advanceTimersByTimeAsync(2000)
      expect(operations.filter((operation) => operation === 'active')).toHaveLength(1)
      expect(operations).not.toContain('cancel')
      expect(await isCopilotRunCancelled(initial.runId)).toBe(false)
      expect(await pending(initial.threadId)).toEqual(initial.pending)
      expect(initial.pending[0]).toMatchObject({ stage: 'result', target: { toolName: 'sleep' } })
      vi.useRealTimers()
      expect(
        (
          await command({
            command: 'tool.result',
            target: initial.pending[0].target,
            assertion: { kind: 'timer.completed', data: { success: true, seconds: 1 } },
          })
        ).result
      ).toMatchObject({ status: 'success', text: 'Continued answer' })
    } finally {
      finish.resolve()
      await responding
      provider.mockRestore()
      transport.mockRestore()
      vi.useRealTimers()
    }
  })

  it('honors Stop recorded between a Studio handback and the next native step', async () => {
    setModel({ tool: 'search_online', args: { query: 'test' } })
    m.route.mockResolvedValueOnce({
      results: [],
      query: 'test',
      type: 'search',
      totalResults: 0,
      source: 'exa',
    })
    const nativeFetch = globalThis.fetch
    let checks = 0
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { identity, operation } = await new Request(input, init).json()
      if (operation === 'active' && ++checks === 2)
        await cancelCopilotRun({ scope, threadId: identity.threadId, runId: identity.runId })
      return nativeFetch(input, init)
    })
    try {
      const { result } = await message({ accessLevel: 'full' })
      expect(result).toMatchObject({ status: 'aborted', pending: [] })
      expect(m.contacts).toHaveLength(1)
      expect(m.route).toHaveBeenCalledTimes(1)
    } finally {
      transport.mockRestore()
    }
  })

  it('propagates worker cancellation before draining a dispatched Studio tool', async () => {
    m.startJobs = false
    setModel({ tool: 'search_online', args: { query: 'test' } })
    const entered = deferred()
    const finish = deferred()
    let toolSignal: AbortSignal | undefined
    m.route.mockImplementationOnce(async (_name, _args, context) => {
      toolSignal = context.signal
      entered.resolve()
      await finish.promise
      toolSignal?.throwIfAborted()
      return { results: [], query: 'test', type: 'search', totalResults: 0, source: 'exa' }
    })
    const response = await executeCopilotCommand(
      {
        command: 'message',
        requestId: crypto.randomUUID(),
        workspaceId: scope.workspaceId,
        model: 'configured/model',
        input: { content: 'Search for test' },
        accessLevel: 'full',
      },
      scope.actorUserId
    )
    const accepted = await response.json()
    expect(accepted.status).toBe('accepted')
    const controller = new AbortController()
    let settled = false
    const running = executeCopilotJob(
      m.jobs.get(accepted.runId)!.payload,
      controller.signal
    ).finally(() => {
      settled = true
    })
    try {
      await entered.promise
      controller.abort(new Error('Trigger run cancelled'))
      await vi.waitFor(async () => {
        expect(await isCopilotRunCancelled(accepted.runId)).toBe(true)
        expect(toolSignal?.aborted).toBe(true)
      })
      expect(settled).toBe(false)
      expect(await readCopilotThreadRun(scope, accepted.threadId)).toBe(accepted.runId)
      await expect(
        claimCopilotThread(scope, accepted.threadId, 'competing-run')
      ).rejects.toMatchObject({ status: 409 })
      finish.resolve()
      await running
      expect(
        (await m.memory.getThreadById({ threadId: accepted.threadId }))!.metadata!.copilotJob
      ).toMatchObject({ status: 'aborted' })
      expect(await readCopilotThreadRun(scope, accepted.threadId)).toBeUndefined()
    } finally {
      // Unblock the baseline implementation even when it misses the parent cancellation.
      await cancelCopilotRun({ scope, threadId: accepted.threadId, runId: accepted.runId })
      finish.resolve()
      await running
    }
  })

  it.each(['connection reset', 'gateway timeout', 'malformed response'] as const)(
    'retains an executing Studio tool after a %s',
    async (failure) => {
      m.startJobs = false
      setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
      const entered = deferred()
      const finish = deferred()
      let remote: Promise<unknown> | undefined
      m.route.mockImplementationOnce(async () => {
        entered.resolve()
        await finish.promise
        return {
          success: true,
          entityKind: 'workflow',
          entityId: 'workflow',
          entityName: 'Changed',
          workspaceId: scope.workspaceId,
        }
      })
      const nativeFetch = globalThis.fetch
      const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        const { operation } = await request.clone().json()
        const server = nativeFetch(input, init)
        if (operation !== 'tool') return server
        remote = server
        void remote.catch(() => undefined)
        await entered.promise
        if (failure === 'connection reset') throw new TypeError('fetch failed: ECONNRESET')
        return failure === 'gateway timeout'
          ? Response.json({ error: { message: 'Gateway timeout' } }, { status: 504 })
          : Response.json({ result: {} })
      })
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      const response = await executeCopilotCommand(
        {
          command: 'message',
          requestId: crypto.randomUUID(),
          workspaceId: scope.workspaceId,
          model: 'configured/model',
          input: { content: 'Rename workflow' },
          accessLevel: 'full',
        },
        scope.actorUserId
      )
      const accepted = await response.json()
      const running = executeCopilotJob(m.jobs.get(accepted.runId)!.payload)
      try {
        await entered.promise
        const owner = await readCopilotThreadOwnership(scope, accepted.threadId)
        expect(owner?.live).toBe(true)
        expect(
          (await m.memory.getThreadById({ threadId: accepted.threadId }))!.metadata!.copilotJob
        ).not.toHaveProperty('status')
        expect(m.contacts).toHaveLength(1)
        expect((await message({ threadId: accepted.threadId })).result.status).toBe('refused')
        const deadline = owner!.leaseExpiresAt!.getTime()
        await vi.advanceTimersByTimeAsync(THREAD_LEASE_MS * 2)
        const held = await readCopilotThreadOwnership(scope, accepted.threadId)
        expect(held?.live).toBe(true)
        expect(held!.leaseExpiresAt!.getTime()).toBeGreaterThan(deadline)
        expect((await message({ threadId: accepted.threadId })).result.status).toBe('refused')
        finish.resolve()
        await remote!.catch(() => undefined)
        await running
        expect(
          (await m.memory.getThreadById({ threadId: accepted.threadId }))?.metadata?.copilotJob
        ).toMatchObject({ status: 'failed' })
        m.startJobs = true
        setModel({ text: 'Recovered answer' })
        expect((await message({ threadId: accepted.threadId })).result).toMatchObject({
          status: 'success',
          text: 'Recovered answer',
        })
      } finally {
        finish.resolve()
        await remote?.catch(() => undefined)
        await running
        transport.mockRestore()
        vi.useRealTimers()
      }
    }
  )

  it.each(['approval', 'review'])(
    'retains a resumed %s writer until its approved effect settles despite cancellation',
    async (stage) => {
      setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
      let initial = suspended((await message({ accessLevel: 'limited' })).result)
      if (stage === 'review') {
        m.route.mockResolvedValueOnce({ requiresReview: true, reviewBaseStateHash: 'base' })
        initial = suspended(
          (
            await command({
              command: 'tool.approve',
              target: initial.pending[0].target,
            })
          ).result
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
        return {
          success: true,
          entityKind: 'workflow',
          entityId: 'workflow',
          entityName: 'Changed',
          workspaceId: scope.workspaceId,
        }
      })
      let acknowledged = false
      const stoppingAbort = vi.spyOn(m.pubsub, 'publish')
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
        expect(stoppingAbort).toHaveBeenCalledWith(AGENT_CONTROL_TOPIC(initial.runId), {
          type: AgentControlEventTypes.ABORT_REQUEST,
          runId: initial.runId,
          data: {},
        })
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
        }
      }
      expect(settled).toBe(true)
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBeUndefined()
      expect(await pending(initial.threadId)).toEqual([])
      setModel({ text: 'Continued after Stop' })
      expect((await message({ threadId: initial.threadId })).result).toMatchObject({
        status: 'success',
        text: 'Continued after Stop',
      })
    }
  )
  it('retains an admitted resume until cancellation settles its preflight', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const entered = deferred()
    const preflight = deferred()
    m.resolve.mockImplementationOnce(async () => {
      entered.resolve()
      await preflight.promise
      return { apiKey: 'admin-key' }
    })
    const continuing = command({
      command: 'tool.approve',
      target: initial.pending[0].target,
    })
    await entered.promise
    const stopping = command({
      command: 'cancel',
      threadId: initial.threadId,
      runId: initial.runId,
    })
    try {
      await vi.waitFor(async () => expect(await isCopilotRunCancelled(initial.runId)).toBe(true))
      await expect(claimCopilotThread(scope, initial.threadId, 'next-run')).rejects.toMatchObject({
        status: 409,
      })
      preflight.resolve()
      expect((await continuing).result.status).not.toBe('success')
      expect((await stopping).result).toMatchObject({ status: 'cancel_requested' })
      expect(m.route).not.toHaveBeenCalled()
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBeUndefined()
    } finally {
      preflight.resolve()
      await Promise.all([continuing, stopping])
    }
  })
  it('admits only one of two continuations prepared from the same suspension', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const ready = deferred()
    const preflight = deferred()
    const effect = deferred()
    const executing = deferred()
    m.resolve.mockImplementation(async () => {
      ready.resolve()
      await preflight.promise
      return { apiKey: 'admin-key' }
    })
    m.route.mockImplementationOnce(async () => {
      executing.resolve()
      await effect.promise
      return {
        success: true,
        entityKind: 'workflow',
        entityId: 'workflow',
        entityName: 'Changed',
        workspaceId: scope.workspaceId,
      }
    })
    const statuses: string[] = []
    const attempts = [0, 1].map(() =>
      command({
        command: 'tool.approve',
        target: initial.pending[0].target,
      }).then(({ result }) => {
        statuses.push(result.status)
      })
    )
    await ready.promise
    try {
      await vi.waitFor(() => expect(statuses).toHaveLength(1))
      preflight.resolve()
      await executing.promise
      expect(statuses[0]).toBe('refused')
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBe(initial.runId)
      expect(m.route).toHaveBeenCalledOnce()
    } finally {
      preflight.resolve()
      effect.resolve()
      await Promise.all(attempts)
    }
    expect(statuses.sort()).toEqual(['refused', 'success'])
  })
  it('clears a rejected native resume and accepts a new message in the same conversation', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    vi.spyOn(m.agent, 'approveToolCall').mockRejectedValueOnce(new Error('Native resume rejected'))
    expect(
      (
        await command({
          command: 'tool.approve',
          target: initial.pending[0].target,
        })
      ).result
    ).toMatchObject({ status: 'failed' })
    expect((await readCopilotThreadOwnership(scope, initial.threadId))?.live).toBe(false)
    expect(await pending(initial.threadId)).toEqual([])
    expect(
      (
        await command({
          command: 'tool.approve',
          target: initial.pending[0].target,
        })
      ).result
    ).toMatchObject({ status: 'refused' })
    expect((await message({ threadId: initial.threadId })).result).toMatchObject({
      status: 'success',
      threadId: initial.threadId,
    })
    expect(m.route).not.toHaveBeenCalled()
  })
  it.each(['private dispatch', 'following approval'] as const)(
    'recovers a real %s after its first discovery read fails',
    async (failure) => {
      const approval = failure === 'following approval'
      const tool = approval ? 'rename_workflow' : 'list_workflows'
      setModel(
        { tool: 'list_workflows', args: { workspaceId: scope.workspaceId } },
        ...(approval ? [{ tool, args: { entityId: 'workflow', name: 'Changed' } }] : []),
        { text: 'Continued' }
      )
      m.route.mockResolvedValueOnce({ entityKind: 'workflow', entities: [], count: 0 })
      const list = m.agent.listSuspendedRuns.bind(m.agent)
      const discovered = vi.fn()
      const spy = vi.spyOn(m.agent, 'listSuspendedRuns').mockImplementation(async (options) => {
        const result = await list(options)
        const call = result.runs
          .flatMap((run) => run.toolCalls)
          .find((call) => call.toolName === tool)
        if (call && !discovered.mock.calls.length) {
          discovered(call)
          throw new Error('Storage unavailable')
        }
        return result
      })
      try {
        const { result } = await message({ accessLevel: approval ? 'limited' : 'full' })
        expect(discovered).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining(
            approval
              ? { requiresApproval: true }
              : { suspendPayload: expect.objectContaining({ studioDispatch: true }) }
          )
        )
        expect(result).toMatchObject({ status: 'failed' })
        if (result.status !== 'failed' || !('pending' in result))
          throw new Error(JSON.stringify(result))
        const { threadId, runId } = result
        const workflows = (await m.storage.getStore('workflows'))!
        if (approval) {
          expect(result.pending).toMatchObject([
            { stage: 'approval', target: { toolName: tool, runId } },
          ])
          expect(await readCopilotThreadRun(scope, threadId)).toBe(runId)
          expect(
            (
              await command({
                command: 'tool.decline',
                target: result.pending[0].target,
                reason: 'Keep the name',
              })
            ).result
          ).toMatchObject({ status: 'success', text: 'Continued' })
          expect(m.route.mock.calls.map(([name]) => name)).toEqual(['list_workflows'])
        } else {
          expect(result.pending).toEqual([])
          expect((await list({ threadId })).runs).toEqual([])
          expect(await workflows.getWorkflowRunById({ runId })).toBeNull()
          expect(await readCopilotThreadRun(scope, threadId)).toBeUndefined()
          expect(await threadClaims()).toHaveLength(0)
          expect((await message({ threadId })).result).toMatchObject({
            status: 'success',
            text: 'Continued',
          })
          expect((await command({ command: 'thread.delete', threadId })).result).toMatchObject({
            status: 'updated',
            operation: 'thread.delete',
            threadId,
          })
          expect(await m.memory.getThreadById({ threadId })).toBeNull()
          expect(m.route).not.toHaveBeenCalled()
        }
      } finally {
        spy.mockRestore()
      }
    }
  )
  it('preserves a known native suspension when pending discovery fails', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Changed' } })
    const list = m.agent.listSuspendedRuns.bind(m.agent)
    let failed = false
    const spy = vi.spyOn(m.agent, 'listSuspendedRuns').mockImplementation(async (options) => {
      if (m.contacts.length && !failed) {
        failed = true
        throw new Error('Storage unavailable')
      }
      return list(options)
    })
    try {
      expect((await message({ accessLevel: 'limited' })).result.status).toBe('failed')
      const [native] = (await m.agent.listSuspendedRuns()).runs
      expect(await readCopilotThreadRun(scope, native.threadId!)).toBe(native.runId)
      expect((await message({ threadId: native.threadId })).result).toMatchObject({
        status: 'refused',
      })
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
        (
          await command({
            command: 'tool.approve',
            target: initial.pending[0].target,
          })
        ).result
      )
    }
    const admissions = m.admit.mock.calls.length
    const charges = m.accept.mock.calls.length
    const dispatches = m.route.mock.calls.length
    const receipts = m.receipts.size
    const models = vi.mocked(resolveConfiguredModel).mock.calls.length
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
      status: 'failed',
      error: { code: status === 409 ? 'STALE_TARGET' : 'INVALID_REQUEST', message: error.message },
    })
    expect(m.resolve).toHaveBeenLastCalledWith('configured/model', undefined)
    expect(m.route).toHaveBeenCalledTimes(dispatches)
    expect(m.receipts.size).toBe(receipts + 1)
    expect(m.contacts).toHaveLength(1)
    expect(resolveConfiguredModel).toHaveBeenCalledTimes(models)
    expect(m.admit).toHaveBeenCalledTimes(admissions)
    expect(m.accept).toHaveBeenCalledTimes(charges)
    expect(await pending(initial.threadId)).toEqual(initial.pending)
    expect(
      (await command({ command: 'thread.observe', threadId: initial.threadId })).result
    ).toMatchObject({ status: 'history' })
    expect(
      (await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId }))
        .result
    ).toMatchObject({ status: 'cancel_requested' })
    expect(await threadClaims()).toHaveLength(0)
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
  it('acknowledges cancellation when a newer turn acquires the conversation during cleanup', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Renamed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    const workflows = (await m.storage.getStore('workflows'))!
    const readOwner = workflows.getRunOwnership.bind(workflows)
    let successor: Awaited<ReturnType<typeof claimCopilotThread>> | undefined
    const spy = vi.spyOn(workflows, 'getRunOwnership').mockImplementation(async (input) => {
      const owner = await readOwner(input)
      if (!owner?.live && !successor && (await isCopilotRunCancelled(initial.runId)))
        successor = await claimCopilotThread(scope, initial.threadId, 'next-run')
      return owner
    })
    try {
      expect(
        (await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId }))
          .result
      ).toMatchObject({ status: 'cancel_requested' })
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBe('next-run')
      expect(await workflows.getWorkflowRunById({ runId: initial.runId })).toBeNull()
    } finally {
      spy.mockRestore()
      await successor?.release()
    }
  })

  it('deletes cancelled native suspensions and their application receipts with the conversation', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Renamed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId })
    expect((await m.agent.listSuspendedRuns({ threadId: initial.threadId })).runs).toEqual([])
    expect(
      (await command({ command: 'thread.delete', threadId: initial.threadId })).result
    ).toMatchObject({ status: 'updated', operation: 'thread.delete' })
    expect((await m.agent.listSuspendedRuns({ threadId: initial.threadId })).runs).toEqual([])
    expect(await m.memory.getThreadById({ threadId: initial.threadId })).toBeNull()
    expect(await isCopilotRunCancelled(initial.runId)).toBe(false)
    expect(await threadClaims()).toHaveLength(0)
  })

  it('refuses to recreate a thread deleted after preflight but before writer admission', async () => {
    setModel({ text: 'Must not run' })
    const threadId = crypto.randomUUID()
    await m.memory.createThread({ threadId, ...nativeConversationIdentity(scope) })
    const memory = (await m.storage.getStore('memory'))!
    const raiseFence = memory.raiseRunFence.bind(memory)
    const spy = vi.spyOn(memory, 'raiseRunFence').mockImplementationOnce(async (fence) => {
      await m.memory.deleteThread(threadId)
      return raiseFence(fence)
    })
    try {
      expect((await message({ threadId })).result).toMatchObject({
        status: 'refused',
        error: { code: 'INVALID_REQUEST', message: 'Copilot thread is unavailable' },
      })
      expect(m.admit).not.toHaveBeenCalled()
      expect(m.contacts).toHaveLength(0)
      expect(await m.memory.getThreadById({ threadId })).toBeNull()
      expect(await memory.listMessages({ threadId, perPage: false })).toMatchObject({
        messages: [],
      })
      expect(await threadClaims()).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('returns HTTP 409 for stale deletion without changing native history or receipts', async () => {
    setModel({ tool: 'rename_workflow', args: { entityId: 'workflow', name: 'Renamed' } })
    const initial = suspended((await message({ accessLevel: 'limited' })).result)
    await command({ command: 'cancel', threadId: initial.threadId, runId: initial.runId })
    const memory = (await m.storage.getStore('memory'))!
    const history = await memory.listMessages({ threadId: initial.threadId, perPage: false })
    const receipts = new Map(m.receipts)
    expect(receipts.size).toBeGreaterThan(0)
    vi.mocked(runtime.deleteNativeThread).mockImplementationOnce(async (_threadId, fence) => {
      throw new RunFenceConflictError(fence, 'deleteThread')
    })

    const outcome = await command({ command: 'thread.delete', threadId: initial.threadId })
    expect(outcome.response.status).toBe(409)
    expect(outcome.result).toMatchObject({ status: 'refused', error: { code: 'STALE_TARGET' } })
    expect(await m.memory.getThreadById({ threadId: initial.threadId })).not.toBeNull()
    expect(await memory.listMessages({ threadId: initial.threadId, perPage: false })).toEqual(
      history
    )
    expect(m.receipts).toEqual(receipts)
    expect(await threadClaims()).toHaveLength(0)
  })

  it.each(['timeout', 'aborted'])(
    'does not unlock a live writer when cancellation waiting is %s',
    async (reason) => {
      setModel({ text: 'Original answer' }, { text: 'Continue here' })
      const initial = (await message()).result
      if (initial.status !== 'success') throw new Error(JSON.stringify(initial))
      const owner = await claimCopilotThread(scope, initial.threadId, initial.runId)
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
        expect((await message({ threadId: initial.threadId })).result).toMatchObject({
          status: 'refused',
        })
        expect(
          (await command({ command: 'thread.delete', threadId: initial.threadId })).result
        ).toMatchObject({ status: 'refused' })
      } finally {
        timeout.mockRestore()
        await owner.release()
      }
      expect((await message({ threadId: initial.threadId })).result).toMatchObject({
        status: 'success',
        threadId: initial.threadId,
        text: 'Continue here',
      })
      expect(await readCopilotThreadRun(scope, initial.threadId)).toBeUndefined()
    }
  )
  it.each(['conflict', 'error'])(
    'releases ownership when memory fence admission returns %s',
    async (failure) => {
      const threadId = crypto.randomUUID()
      await m.memory.createThread({ threadId, ...nativeConversationIdentity(scope) })
      const memory = (await m.storage.getStore('memory'))!
      const spy = vi.spyOn(memory, 'raiseRunFence').mockImplementationOnce(async () => {
        if (failure === 'error') throw new Error('Memory storage unavailable')
        return false
      })
      try {
        expect((await message({ threadId })).result.status).toBe(
          failure === 'conflict' ? 'refused' : 'failed'
        )
        expect(await threadClaims()).toHaveLength(0)
        expect(m.contacts).toHaveLength(0)
        setModel({ text: 'Retry answer' })
        expect((await message({ threadId })).result.status).toBe('success')
      } finally {
        spy.mockRestore()
      }
    }
  )

  it.each(['saveMessages', 'deleteMessages', 'new-message', 'assistant-save'] as const)(
    'rejects a stale writer delayed at %s after a successor completes',
    async (operation) => {
      const nativeAssistant = operation === 'assistant-save'
      const newMessage = nativeAssistant || operation === 'new-message'
      setModel(
        { text: 'Original answer' },
        ...(nativeAssistant ? [{ text: 'Stale answer' }] : []),
        {
          text: 'Successor answer',
        }
      )
      const initial = (await message()).result
      if (initial.status !== 'success') throw new Error(JSON.stringify(initial))
      const memory = (await m.storage.getStore('memory'))!
      const query = { threadId: initial.threadId, perPage: false as const }
      const history = await memory.listMessages(query)
      const messageId = history.messages.find((item) => item.role === 'user')!.id
      const entered = deferred()
      const gate = deferred()
      const save = memory.saveMessages.bind(memory)
      const remove = memory.deleteMessages.bind(memory)
      let held = false
      const spy =
        operation === 'deleteMessages'
          ? vi.spyOn(memory, operation).mockImplementationOnce(async (...args) => {
              entered.resolve()
              await gate.promise
              return remove(...args)
            })
          : vi.spyOn(memory, 'saveMessages').mockImplementation(async (input) => {
              if (
                !held &&
                (!nativeAssistant || input.messages.some((item) => item.role === 'assistant'))
              ) {
                held = true
                entered.resolve()
                await gate.promise
              }
              return save(input)
            })
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      const editing = message({
        threadId: initial.threadId,
        ...(newMessage ? {} : { messageId }),
        input: { content: 'Stale writer prompt' },
      })
      try {
        await entered.promise
        const owner = await readCopilotThreadOwnership(scope, initial.threadId)
        vi.setSystemTime(owner!.leaseExpiresAt!.getTime() + 1)
        restart()
        const abort = vi.spyOn(m.pubsub, 'publish')
        expect(
          (
            await message({
              threadId: initial.threadId,
              messageId,
              input: { content: 'Successor prompt' },
            })
          ).result
        ).toMatchObject({ status: 'success', text: 'Successor answer' })
        const completedHistory = structuredClone(await memory.listMessages(query))
        const completedJob = structuredClone(
          (await m.memory.getThreadById({ threadId: initial.threadId }))!.metadata!.copilotJob
        )
        gate.resolve()
        await editing
        expect(await memory.listMessages(query)).toEqual(completedHistory)
        expect(
          (await m.memory.getThreadById({ threadId: initial.threadId }))!.metadata!.copilotJob
        ).toEqual(completedJob)
        expect(
          abort.mock.calls.some(([, event]) => event.type === AgentControlEventTypes.ABORT_REQUEST)
        ).toBe(false)
      } finally {
        gate.resolve()
        await editing
        spy.mockRestore()
        vi.useRealTimers()
      }
    }
  )

  it.each([false, true])(
    'waits for the native writer before cancelling and editing (other instance: %s)',
    async (otherInstance) => {
      setModel({ text: 'Original answer' }, { text: 'Delayed persisted answer' })
      const initial = (await message()).result
      if (initial.status !== 'success') throw new Error(JSON.stringify(initial))
      const memory = (await m.storage.getStore('memory'))!
      const save = memory.saveMessages.bind(memory)
      const writing = deferred()
      const gate = deferred()
      let held = false
      let persisted = false
      const spy = vi.spyOn(memory, 'saveMessages').mockImplementation(async (args) => {
        if (!held && args.messages.some((item) => item.role === 'assistant')) {
          held = true
          writing.resolve()
          await gate.promise
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
            requestId: crypto.randomUUID(),
            model: 'configured/model',
            threadId: initial.threadId,
            input: { content: 'Keep ownership until persisted' },
          },
          scope.actorUserId
        )
        const first = await response.json()
        expect(first.status).toBe('accepted')
        await writing.promise
        if (otherInstance) restart()
        const abort = vi.spyOn(m.pubsub, 'publish')
        const contacts = m.contacts.length
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
        expect(abort).toHaveBeenCalledWith(AGENT_CONTROL_TOPIC(first.runId), {
          type: AgentControlEventTypes.ABORT_REQUEST,
          runId: first.runId,
          data: {},
        })
        expect(m.contacts).toHaveLength(contacts)
        expect(acknowledged).toBe(false)
        expect(await readCopilotThreadRun(scope, first.threadId)).toBe(first.runId)
        expect(persisted).toBe(false)
        expect((await message({ threadId: first.threadId })).result).toMatchObject({
          status: 'refused',
        })
        gate.resolve()
        await Promise.all(m.executions.values())
        expect(await (await stopping).json()).toMatchObject({
          status: 'cancel_requested',
          runId: first.runId,
        })
        expect(persisted).toBe(true)
        expect(await readCopilotThreadRun(scope, first.threadId)).toBeUndefined()
        expect(await pending(first.threadId)).toEqual([])
        const history = await memory.listMessages({
          threadId: first.threadId,
          resourceId: nativeConversationIdentity(scope).resourceId,
          perPage: false,
          orderBy: { field: 'createdAt', direction: 'ASC' },
        })
        expect(
          history.messages.some(
            (item) =>
              item.role === 'user' &&
              item.content.parts.some(
                (part) => part.type === 'text' && part.text === 'Keep ownership until persisted'
              )
          )
        ).toBe(true)
        expect(
          (
            await message({
              threadId: first.threadId,
              messageId: history.messages[0].id,
              input: { content: 'Edited prompt' },
            })
          ).result
        ).toMatchObject({ status: 'success' })
      } finally {
        gate.resolve()
        spy.mockRestore()
      }
    }
  )
})
