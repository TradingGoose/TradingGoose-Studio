import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Agent } from '@mastra/core/agent'
import type {
  MastraDBMessage,
  MastraErrorPart,
  MastraMessagePart,
} from '@mastra/core/agent/message-list'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import {
  orderHistoryTable,
  pendingExecution,
  permissions,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workflowLogWebhookDelivery,
  workspace,
} from '@tradinggoose/db/schema'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  url: process.env.MASTRA_TEST_DATABASE_URL,
  client: undefined as any,
  db: undefined as any,
  settings: {
    WORKFLOW_ARCHIVE_PROVIDER: 'local',
    WORKFLOW_ARCHIVE_PRIVATE_VERIFIED: true,
    WORKFLOW_ARCHIVE_LOCAL_ROOT: '',
    ENCRYPTION_KEY: '11'.repeat(32),
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:1',
    NODE_ENV: 'test',
  } as Record<string, any>,
  emissions: [] as any[],
  historicalFinanceRefusal: false,
}))
// Source-only failure boundary: no monetary storage/contact is delegated by this facade.
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: async (scope: {
    runId: string
    actorUserId: string
    workspaceId: string
    purpose: string
  }) => ({
    namespace: 'billing-usage:synthetic-payload',
    key: scope.runId,
    fingerprint: 'synthetic-payload-binding',
    ...scope,
    workflowId: null,
  }),
  admitFinancialModelStep: async () => {},
  acceptFinancialModelStep: async () => {
    throw new Error('Synthetic postresponse acceptance rejection')
  },
}))
// Completion publication is real SQL/native IO; money and event transport are separate seams.
vi.mock('@/lib/logs/execution/financial-acceptance', () => ({
  verifyWorkflowFinancialAcceptance: async () => {
    if (fixture.historicalFinanceRefusal)
      throw new Error('Original historical financial binding is unavailable; source stays pinned')
  },
}))
vi.mock('@/lib/logs/events', () => ({
  emitWorkflowExecutionCompleted: async (value: unknown) => fixture.emissions.push(value),
}))
// These transports are not part of save/checkpoint-CAS. Fail on unexpected use,
// without initializing unrelated session, email or Trigger clients on import.
vi.mock('@/lib/auth/workflow-scope', () => ({
  authorizeWorkflowScope: async () => {
    throw new Error('Session transport is outside this owned payload source fixture')
  },
}))
vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: async () => {
    throw new Error('Queue transport is outside this owned payload source fixture')
  },
  isPendingWorkflowExecutionCancellationRequested: async () => {
    throw new Error('Queue cancellation transport is outside this owned payload source fixture')
  },
  PENDING_EXECUTION_CANCELLATION_ERROR: 'Workflow execution was cancelled',
}))
vi.mock('@tradinggoose/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  if (!fixture.url) return { db: {} }
  // Deliberately small real application pool: queued writers must not re-enter it.
  fixture.client = postgres(fixture.url, { max: 2, prepare: false })
  fixture.db = drizzle(fixture.client)
  return { db: fixture.db }
})
vi.mock('@/lib/env', () => ({
  env: fixture.settings,
  getEnv: (key: string) => fixture.settings[key] ?? '',
  isTruthy: (value: unknown) => value === true || value === 'true',
}))

import { ExecutionLogger, executionLogger } from '@/lib/logs/execution/logger'
import { financialProcessors } from '@/lib/mastra/financial-processors'
import { decodeWorkflowMessage } from '@/lib/mastra/messages'
import { NATIVE_AGENT_POLICY } from '@/lib/mastra/options'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import * as runtime from '@/lib/mastra/runtime'
import { createNativeStorage, PASSIVE_MEMORY_OPTIONS } from '@/lib/mastra/runtime'
import { resultAccounting } from '@/lib/mastra/usage'
import * as history from '@/lib/mastra/workflow-history'
import {
  type NativePayloadRef,
  readFunctionalPayload,
  readNativePayloadMessages,
  writeFunctionalPayload,
} from '@/lib/mastra/workflow-history'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'
import { saveWorkflowCheckpoint } from '@/lib/workflows/human-in-the-loop/service'
import { createMockContext } from '@/executor/__test-utils__/executor-mocks'
import {
  checkpointFunctionalOutput,
  finalizeExecutorCheckpoint,
  saveExecutionContext,
} from '@/executor/checkpoint'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import {
  assertRetainedLogAccess,
  FUNCTIONAL_OUTPUT_REFERENCE,
  hydrateCheckpointFunctionalPayloads,
  hydrateExecutionPayload,
} from './functional'
import * as archiveIO from './io'
import { readPrivateArchive } from './io'
import {
  ArchivePruneDeferredError,
  deleteArchivedWorkflowLog,
  prepareWorkflowArchive,
  preserveHistoricalWorkflowPayload,
  pruneArchivedWorkflowPayload,
} from './lifecycle'

const tests = fixture.url ? describe : describe.skip
tests('disposable native functional payload and private cold handoff', () => {
  let native: ReturnType<typeof createNativeStorage>
  let memory: Memory
  let store: any
  let root = ''
  const ws = `archive-ws-${crypto.randomUUID()}`
  const logId = `archive-log-${crypto.randomUUID()}`
  const executionId = `archive-exec-${crypto.randomUUID()}`
  const snapshotId = `archive-snapshot-${crypto.randomUUID()}`
  const scope = { workspaceId: ws, executionId, logId }
  const userText =
    ' \n\tBefore user\n```xml\n<working_memory>literal user 🔥</working_memory>\n```\nAfter user\t \n'
  const assistantText =
    '\t \nBefore assistant\n```ts\nconst literal = "<working_memory>literal assistant 🔥</working_memory>"\n```\nAfter assistant \n\t'
  const ordinaryParts: MastraMessagePart[] = [
    { type: 'step-start', model: 'native-model-correlation' },
    {
      type: 'reasoning',
      reasoning: ' \nExact ordinary reasoning\t ',
      providerMetadata: { native: { signature: 'actual-retained-reasoning-signature' } },
      details: [{ type: 'text', text: ' \nExact ordinary reasoning detail\t ' }],
    },
    { type: 'text', text: assistantText },
    {
      type: 'tool-invocation',
      toolInvocation: {
        state: 'result',
        toolCallId: 'ordinary-tool-result',
        toolName: 'fixed-tool',
        args: { text: userText },
        result: {
          text: assistantText,
          type: 'error',
          error: { name: 'Business field', message: 'Ordinary nested business error' },
          execution: { success: false },
        },
      },
    },
    {
      type: 'file',
      mimeType: 'image/png',
      providerMetadata: { native: { signature: 'actual-retained-image-signature' } },
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
    },
  ]
  const selectedMessages = [
    { role: 'system' as const, content: ' A🔥\n ' },
    { role: 'system' as const, content: 'repeat' },
    { role: 'system' as const, content: 'repeat' },
    { role: 'user' as const, content: userText },
  ]
  const requestKey = 'canonical-diagnostic-request-key-fixture'
  const sdkRequestKey = 'actual-native-model-request-key-fixture'
  const rawResponse = 'raw-sdk-response-body-fixture'
  const providerFacts = 'extra-provider-error-facts-fixture'
  const safeErrorPart: MastraErrorPart = {
    type: 'error',
    error: {
      name: 'Error',
      message: 'Model request failed. Check the selected model and connection.',
    },
  }
  const diagnosticPart: MastraErrorPart = {
    type: 'error',
    createdAt: 1767225600000,
    providerMetadata: { fixture: { requestKey } },
    error: {
      name: `ProviderAuthenticationError:${requestKey}`,
      message: `Provider rejected ${requestKey}`,
      responseBody: JSON.stringify({ authorization: `Bearer ${requestKey}`, rawResponse }),
      requestId: `request:${requestKey}`,
      modelId: `model:${requestKey}`,
      statusCode: 401,
      codes: [providerFacts, requestKey],
      reason: `${providerFacts}:${requestKey}`,
    },
  }
  const output = {
    content: assistantText,
    error: 'Model request failed safely; completed functional work is retained',
    facts: { completedTool: 'fixed-tool', partial: true },
    model: 'schema-owned',
    tokens: 7,
    cost: { business: 'kept' },
    nested: { inference: 'ordinary user data' },
    agent: withInferenceFacts(
      {
        content: 'exact agent output',
        model: 'openai/gpt-4.1',
        tokens: { total: 7 },
        cost: { status: 'unavailable' },
        toolCost: { total: 1 },
        unavailableToolCosts: ['tool'],
        providerTiming: { duration: 9 },
      },
      {
        generatedFields: [
          'model',
          'tokens',
          'cost',
          'toolCost',
          'unavailableToolCosts',
          'providerTiming',
        ],
      }
    ),
    evaluator: withInferenceFacts(
      { score: 0.75, tokens: { total: 3 }, cost: { status: 'unavailable' } },
      { generatedFields: ['tokens', 'cost'] }
    ),
    router: withInferenceFacts(
      {
        model: 'openai/gpt-4.1',
        selectedPath: { blockId: 'next' },
        tokens: { total: 2 },
        cost: { status: 'unavailable' },
      },
      { generatedFields: ['model', 'tokens', 'cost'] }
    ),
  }
  const functionalOutput = {
    ...output,
    agent: { content: 'exact agent output', model: 'openai/gpt-4.1' },
    evaluator: { score: 0.75 },
    router: { model: 'openai/gpt-4.1', selectedPath: { blockId: 'next' } },
  }

  let ref: NativePayloadRef
  const retainedVersions: NativePayloadRef[] = []
  const concurrentRefs: NativePayloadRef[] = []
  const concurrentLogs: string[] = []
  const independentAnchors: Array<{ workspaceId: string; snapshotId: string }> = []
  async function freshOwner(blockId: string) {
    const id = `archive-r9-log-${crypto.randomUUID()}`
    const execution = `archive-r9-exec-${crypto.randomUUID()}`
    const workflowId = `archive-r9-workflow-${crypto.randomUUID()}`
    const workspaceId = `archive-r9-workspace-${crypto.randomUUID()}`
    const ownedSnapshotId = `archive-r9-snapshot-${crypto.randomUUID()}`
    concurrentLogs.push(id)
    independentAnchors.push({ workspaceId, snapshotId: ownedSnapshotId })
    await fixture.client`insert into workspace (id,owner_id) values (${workspaceId},'archive-owner')`
    await fixture.client`insert into workflow_execution_snapshots (id,workflow_id,workspace_id,state_hash,state_data,created_at) values (${ownedSnapshotId},${workflowId},${workspaceId},'r9-fixture',${JSON.stringify({ blocks: { a: { id: 'a' } } })},now())`
    await fixture.client`insert into workflow_execution_logs (id,workflow_id,workspace_id,execution_id,state_snapshot_id,execution_data,started_at,created_at,level,trigger) values (${id},${workflowId},${workspaceId},${execution},${ownedSnapshotId},${JSON.stringify({ environment: { userId: 'archive-owner' } })},now(),now(),'info','manual')`
    return {
      workspaceId,
      workflowId,
      executionId: execution,
      logId: id,
      blockId,
      runId: 'r9-run',
      actorUserId: 'archive-owner',
    }
  }
  beforeAll(async () => {
    if (
      !fixture.url ||
      !['localhost', '127.0.0.1'].includes(new URL(fixture.url).hostname) ||
      !new URL(fixture.url).pathname.endsWith('_disposable')
    )
      throw new Error('Disposable loopback database required')
    root = await mkdtemp(path.join(tmpdir(), 'workflow-lifecycle-'))
    fixture.settings.WORKFLOW_ARCHIVE_LOCAL_ROOT = root
    native = createNativeStorage(fixture.url, true)
    await native.storage.init()
    memory = new Memory({ storage: native.storage, options: PASSIVE_MEMORY_OPTIONS })
    store = (await native.storage.getStore('memory'))!
    vi.spyOn(runtime, 'getNativeMemory').mockResolvedValue(memory)
    vi.spyOn(runtime, 'getNativeMemoryStore').mockResolvedValue(store)
    for (const table of [
      workspace,
      permissions,
      workflowExecutionLogs,
      workflowExecutionSnapshots,
      pendingExecution,
      workflowLogWebhookDelivery,
      orderHistoryTable,
    ]) {
      const config = getTableConfig(table)
      const columns = config.columns
        .map((column) => {
          const type = column.getSQLType()
          return `"${column.name}" ${/^(text|varchar|integer|bigint|boolean|timestamp|json|uuid|numeric|double)/.test(type) ? type : 'text'}`
        })
        .join(',')
      await fixture.client.unsafe(`create table if not exists "${config.name}" (${columns})`)
    }
    await fixture.client`insert into workspace (id,owner_id) values (${ws},'archive-owner')`
    await fixture.client`insert into workflow_execution_snapshots (id,workspace_id,state_hash,state_data,created_at) values (${snapshotId},${ws},'fixture',${JSON.stringify({ blocks: { a: { id: 'a' } } })},now())`
    await fixture.client`insert into workflow_execution_logs (id,workspace_id,execution_id,state_snapshot_id,execution_data,started_at,created_at,level,trigger) values (${logId},${ws},${executionId},${snapshotId},${JSON.stringify({ environment: { userId: 'archive-owner' } })},now(),now(),'info','manual')`
  }, 60000)
  afterAll(async () => {
    vi.restoreAllMocks()
    // Only fixture-owned producers below have settled before this synthetic cleanup.
    for (const entry of concurrentRefs) await store?.deleteThread({ threadId: entry.threadId })
    if (store && ref) await store.deleteThread({ threadId: ref.threadId })
    if (fixture.client) {
      for (const id of concurrentLogs)
        await fixture.client`delete from workflow_execution_logs where id=${id}`
      for (const anchor of independentAnchors) {
        await fixture.client`delete from workflow_execution_snapshots where id=${anchor.snapshotId}`
        await fixture.client`delete from workspace where id=${anchor.workspaceId}`
      }
      await fixture.client`delete from workflow_execution_logs where id=${logId}`
      await fixture.client`delete from workflow_execution_snapshots where id=${snapshotId}`
      await fixture.client`delete from workspace where id=${ws}`
      await fixture.client.end({ timeout: 2 })
    }
    await native?.close()
    if (root) await rm(root, { recursive: true, force: true })
  }, 20000)
  it('completes thirty real payload writers through a saturated two-connection application pool without global owner reads', async () => {
    const scopes = []
    for (let index = 0; index < 30; index++) {
      const id = `archive-pool-log-${crypto.randomUUID()}`
      const execution = `archive-pool-exec-${crypto.randomUUID()}`
      concurrentLogs.push(id)
      await fixture.client`insert into workflow_execution_logs (id,workspace_id,execution_id,state_snapshot_id,execution_data,started_at,created_at,level,trigger) values (${id},${ws},${execution},${snapshotId},${JSON.stringify({ environment: { userId: 'archive-owner' } })},now(),now(),'info','manual')`
      scopes.push({
        workspaceId: ws,
        executionId: execution,
        logId: id,
        blockId: 'pool-block',
        runId: `pool-run-${index}`,
        actorUserId: 'archive-owner',
      })
    }
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let arrivals = 0
    const original = memory.getThreadById.bind(memory)
    const lookup = vi.spyOn(memory, 'getThreadById').mockImplementation(async (args) => {
      const value = await original(args)
      if (arrivals < 2) {
        arrivals++
        await barrier
      }
      return value
    })
    // Real Drizzle transaction objects have their own select; this only observes forbidden
    // re-entry through the global application database while its two slots are occupied.
    const globalRead = vi.spyOn(fixture.db, 'select')
    const writes = Promise.all(
      scopes.map(async (owner, index) => {
        const entry = await writeFunctionalPayload(owner, {
          selectedMessages: [
            {
              role: 'user',
              content: ` exact pool input ${index} <working_memory>🔥</working_memory>\n`,
            },
          ],
          output: { index, content: ' exact canonical output\t ' },
        })
        concurrentRefs.push(entry)
        return entry
      })
    )
    // Attach a rejection handler before awaiting the real native-read barrier.
    const completion = writes.then(
      (entries) => ({ entries }),
      (error: unknown) => ({ error })
    )
    let barrierError: unknown
    try {
      await vi.waitFor(() => expect(arrivals).toBe(2))
      expect(globalRead).not.toHaveBeenCalled()
    } catch (error) {
      barrierError = error
    } finally {
      release()
    }
    const outcome = await completion
    expect(barrierError).toBeUndefined()
    lookup.mockRestore()
    expect('error' in outcome ? outcome.error : undefined).toBeUndefined()
    if (!('entries' in outcome)) throw outcome.error
    expect(outcome.entries).toHaveLength(30)
    expect(globalRead).not.toHaveBeenCalled()
    // Independent later reads still use fresh global authorization around native IO.
    for (const [index, entry] of outcome.entries.entries()) {
      const payload = await readFunctionalPayload(entry)
      expect(payload.selectedMessages).toEqual([
        {
          role: 'user',
          content: ` exact pool input ${index} <working_memory>🔥</working_memory>\n`,
        },
      ])
      expect(payload.output).toEqual({ index, content: ' exact canonical output\t ' })
    }
    expect(globalRead.mock.calls.length).toBeGreaterThanOrEqual(90)
    globalRead.mockRestore()
  })
  it('stores exact selected systems, genuine native parts and structured fields once, with verified reusable readback and immutable IDs', async () => {
    const retained = await financialProcessors({
      actorUserId: 'archive-owner',
      workspaceId: ws,
      runId: 'r4-payload-usage',
      purpose: 'source-payload',
    })
    const completed = new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Completed before acceptance rejection' }],
        finishReason: 'stop',
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        warnings: [],
      }),
    })
    const rejected = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: 'r4-payload-rejected-acceptance',
      name: 'Source fixture',
      instructions: '',
      model: completed,
      inputProcessors: retained.inputProcessors,
      outputProcessors: retained.outputProcessors,
    })
    await expect(
      rejected.generate('source-only', {
        runId: 'r4-payload-usage',
        maxSteps: 1,
        maxProcessorRetries: 0,
        modelSettings: { maxRetries: 0 },
      })
    ).rejects.toThrow('Synthetic postresponse acceptance rejection')
    expect(completed.doGenerateCalls).toHaveLength(1)
    expect(retained.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
    const accounting = resultAccounting(retained.getUsage())
    const knownFailure = withInferenceFacts(
      {
        text: 'Known failure output',
        ...accounting,
        business: { tokens: 'literal business units', cost: 'schema-owned price' },
      },
      { ...accounting, generatedFields: ['tokens', 'cost'] }
    )
    expect(getInferenceFacts(knownFailure)?.tokens).toEqual({ prompt: 2, completion: 3, total: 5 })
    Object.assign(output, { retainedAcceptanceFailure: knownFailure })
    Object.assign(functionalOutput, {
      retainedAcceptanceFailure: {
        text: 'Known failure output',
        business: { tokens: 'literal business units', cost: 'schema-owned price' },
      },
    })

    const nativeMessages = new Map<string, MastraDBMessage>()
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        throw new Error(`Actual native provider rejected ${sdkRequestKey}`)
      },
    })
    const agent = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: 'archive-native-error-fixture',
      name: 'Archive native error fixture',
      instructions: '',
      model,
    })
    let nativeFailure: unknown
    try {
      const result = await agent.generate(
        selectedMessages.filter((message) => message.role !== 'system'),
        {
          maxSteps: 1,
          maxProcessorRetries: 0,
          onStepFinish: (step) => {
            for (const message of step.response?.dbMessages ?? [])
              nativeMessages.set(message.id, message)
          },
        }
      )
      nativeFailure = result.error
    } catch (error) {
      nativeFailure = error
    }
    expect(nativeFailure).toBeDefined()
    expect(model.doGenerateCalls).toHaveLength(1)
    const actualNativeMessages = [...nativeMessages.values()]
    expect(actualNativeMessages).toHaveLength(1)
    expect(actualNativeMessages[0].role).toBe('assistant')
    expect(actualNativeMessages[0].content.parts).toContainEqual(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ message: expect.stringContaining(sdkRequestKey) }),
      })
    )
    // Optional-field stress is constructed; actualNativeMessages comes from the SDK.
    const response = {
      id: 'actual-native-response',
      role: 'assistant' as const,
      createdAt: new Date(),
      content: {
        format: 2 as const,
        providerMetadata: { native: { signature: 'functional-content-signature' } },
        parts: [...ordinaryParts, diagnosticPart],
      },
    }
    const payload = {
      selectedMessages,
      messages: [response, ...actualNativeMessages],
      output,
      tools: [
        { name: 'fixed-tool', toolCallId: 'ok', success: true, result: { value: 'actual' } },
        {
          name: 'failed-tool',
          toolCallId: 'failed',
          success: false,
          result: { error: 'ordinary failure retained' },
        },
        {
          name: 'incurred-tool',
          toolCallId: 'incurred',
          success: false,
          result: withInferenceFacts(
            { value: 'incurred functional result', cost: { total: 1 } },
            { generatedFields: ['cost'] }
          ),
        },
        {
          name: 'used-tool',
          toolCallId: 'used',
          success: false,
          result: withInferenceFacts(
            { value: 'usage functional result', tokens: { total: 2 } },
            { generatedFields: ['tokens'] }
          ),
        },
      ],
      blocks: [
        {
          id: 'a',
          name: 'Agent',
          type: 'agent',
          blockId: 'a',
          duration: 1,
          startTime: '2026-01-01',
          endTime: '2026-01-01',
          input: { system: 'actual', messages: selectedMessages },
          output,
        },
      ],
    }
    const owned = { ...scope, blockId: 'a', runId: 'run', actorUserId: 'archive-owner' }
    ref = await writeFunctionalPayload(owned, payload)
    const returned = await readFunctionalPayload(ref)
    expect(returned.selectedMessages).toEqual(selectedMessages)
    expect(returned.output).toEqual(functionalOutput)
    expect(returned.blocks).toEqual(checkpointFunctionalOutput(payload.blocks))
    expect(knownFailure.tokens).toEqual({ prompt: 2, completion: 3, total: 5 })
    expect(output.agent.tokens).toEqual({ total: 7 })
    expect(output.agent.providerTiming).toEqual({ duration: 9 })
    expect(returned.tools).toEqual(checkpointFunctionalOutput(payload.tools))
    expect(returned.toolResultIndexes).toEqual([0, 2, 3])
    expect(returned.messages?.[0].content.providerMetadata).toEqual(
      response.content.providerMetadata
    )
    const checkpoint = {
      executor: {
        context: {
          blockLogs: [
            {
              id: 'lifecycle.storage.test.ts:saved-occurrence:1',
              blockId: 'a',
              inference: { nativePayload: ref, generatedFields: ['toolResults'] },
            },
          ],
          blockStates: [],
        },
        currentBlockStates: {},
      },
    } as any
    const hydrated = await hydrateCheckpointFunctionalPayloads(checkpoint, scope)
    expect(hydrated.executor.context.blockLogs[0].output.toolResults).toEqual([
      { value: 'actual', toolCallId: 'ok' },
      { value: 'incurred functional result', toolCallId: 'incurred' },
      { value: 'usage functional result', toolCallId: 'used' },
    ])
    expect(hydrated.executor.context.blockLogs[0].output.toolResults).toHaveLength(3)
    expect(returned.messages?.[0].content.parts.filter((part) => part.type !== 'error')).toEqual(
      ordinaryParts
    )
    expect(returned.messages?.[0].content.parts.filter((part) => part.type === 'error')).toEqual([
      safeErrorPart,
    ])
    expect(returned.messages?.[1].content.parts).toEqual([safeErrorPart])
    for (const forbidden of [requestKey, sdkRequestKey, rawResponse, providerFacts])
      expect.soft(JSON.stringify(returned)).not.toContain(forbidden)
    const repeated = await writeFunctionalPayload(owned, payload)
    const revision = await writeFunctionalPayload(owned, { ...payload, output: { changed: true } })
    retainedVersions.push(repeated, revision)
    expect(repeated.threadId).toBe(ref.threadId)
    expect(repeated.messageIds.every((id) => !ref.messageIds.includes(id))).toBe(true)
    expect(
      revision.messageIds.every(
        (id) => !repeated.messageIds.includes(id) && !ref.messageIds.includes(id)
      )
    ).toBe(true)
    expect((await readFunctionalPayload(ref)).output).toEqual(functionalOutput)
    expect((await readFunctionalPayload(revision)).output).toEqual({ changed: true })
    const rows = await readNativePayloadMessages(ref)
    expect(rows).toHaveLength(7)
    expect(rows[0].content.parts[0].type).toBe('data-workflow-system-message')
    expect(rows[3].content.parts).toEqual([{ type: 'text', text: userText }])
    expect(rows[4].content.parts.filter((part) => part.type !== 'error')).toEqual(ordinaryParts)
    for (const forbidden of [requestKey, sdkRequestKey, rawResponse, providerFacts])
      expect.soft(JSON.stringify(rows)).not.toContain(forbidden)
    const originalThread = await store.getThreadById({ threadId: ref.threadId })
    const wrongResource = vi
      .spyOn(store, 'getThreadById')
      .mockResolvedValue({ ...originalThread, resourceId: 'unrelated-resource' })
    try {
      await expect(readFunctionalPayload(ref)).rejects.toThrow('mismatched')
      await expect(writeFunctionalPayload(owned, payload)).rejects.toThrow('ownership mismatch')
    } finally {
      wrongResource.mockRestore()
    }
    await fixture.client`update workflow_execution_logs set execution_data=${JSON.stringify({ environment: { userId: 'archive-owner' }, functionalPayload: ref, nativePayloads: { a: ref, ...Object.fromEntries(retainedVersions.map((entry) => [entry.digest, entry])) }, finalOutput: FUNCTIONAL_OUTPUT_REFERENCE })} where id=${logId}`
  })
  it('pins nonterminal consumers and refuses new canonical writes after terminal owner closes', async () => {
    await expect(prepareWorkflowArchive(logId)).rejects.toThrow('pinned')
    await fixture.client`update workflow_execution_logs set ended_at=now() where id=${logId}`
    await expect(
      writeFunctionalPayload({ ...scope, blockId: 'a', runId: 'run' }, { output })
    ).rejects.toThrow('closed')
  })
  it('commits verified private readback and retains exact native, Records and output data while destructive cleanup is deferred', async () => {
    const archive = await prepareWorkflowArchive(logId)
    const artifact = await readPrivateArchive(archive)
    expect(artifact.nativeThreads).toHaveLength(3)
    expect(
      artifact.nativeThreads
        .map((entry: { reference: NativePayloadRef }) => entry.reference.digest)
        .sort()
    ).toEqual([ref.digest, ...retainedVersions.map((entry) => entry.digest)].sort())
    for (const entry of artifact.nativeThreads) {
      const original = [ref, ...retainedVersions].find(
        (value) => value.digest === entry.reference.digest
      )!
      expect(entry.reference).toEqual(original)
      expect(entry.messages.map((message: MastraDBMessage) => message.id)).toEqual(
        original.messageIds
      )
    }
    expect(artifact.functional.output).toEqual(functionalOutput)
    for (const forbidden of [requestKey, sdkRequestKey, rawResponse, providerFacts])
      expect.soft(JSON.stringify(artifact)).not.toContain(forbidden)
    expect(artifact.functional.blocks[0].input.messages).toEqual(selectedMessages)
    const archivedMessages: Awaited<ReturnType<typeof readNativePayloadMessages>> =
      artifact.nativeThreads[0].messages
    expect(
      archivedMessages
        .filter((message) => message.content.metadata?.workflowSection === 'input')
        .map((message) => decodeWorkflowMessage(message, ref))
    ).toEqual(selectedMessages)
    expect(archivedMessages[4].content.parts.filter((part) => part.type !== 'error')).toEqual(
      ordinaryParts
    )
    expect(archivedMessages[4].content.providerMetadata).toEqual({
      native: { signature: 'functional-content-signature' },
    })
    expect((archivedMessages[6].content.parts[0] as any).data.toolResultIndexes).toEqual([0, 2, 3])
    expect(artifact.nativeThreads[0].messages[0].content.parts[0].type).toBe(
      'data-workflow-system-message'
    )
    expect(artifact.record.executionData).not.toHaveProperty('traceSpans')
    expect(artifact.record.executionData).not.toHaveProperty('nativePayloads')
    const nativeContact = vi.mocked(runtime.getNativeMemoryStore)
    nativeContact.mockClear()
    const nativeDelete = vi.spyOn(store, 'deleteThread')
    try {
      await expect(pruneArchivedWorkflowPayload(logId)).rejects.toBeInstanceOf(
        ArchivePruneDeferredError
      )
      await expect(deleteArchivedWorkflowLog(logId, sql`true`)).rejects.toBeInstanceOf(
        ArchivePruneDeferredError
      )
      expect(await deleteArchivedWorkflowLog(logId, sql`false`)).toBe(false)
      expect(nativeContact).not.toHaveBeenCalled()
      expect(nativeDelete).not.toHaveBeenCalled()
    } finally {
      nativeDelete.mockRestore()
    }
    expect(
      await store.getThreadById({ threadId: ref.threadId, resourceId: ref.resourceId })
    ).not.toBeNull()
    const [row] = await fixture.db
      .select()
      .from(workflowExecutionLogs)
      .where((await import('drizzle-orm')).eq(workflowExecutionLogs.id, logId))
      .limit(1)
    const hydrated = await hydrateExecutionPayload({ ...row, ...scope }, () =>
      assertRetainedLogAccess(scope, 'archive-owner')
    )
    expect(hydrated.executionData.finalOutput).toEqual(functionalOutput)
    expect(hydrated.executionData.traceSpans[0].output).toEqual(functionalOutput)
    expect(hydrated.executionData.traceSpans[0].input.messages).toEqual(selectedMessages)
    for (const forbidden of [requestKey, sdkRequestKey, rawResponse, providerFacts])
      expect(JSON.stringify(hydrated)).not.toContain(forbidden)
    expect(hydrated.executionData.traceSpans[0]).not.toHaveProperty('nativePayload')
    expect(hydrated.executionData.traceSpans[0]).not.toHaveProperty('inference')
    expect(await prepareWorkflowArchive(logId)).toEqual(archive)
    await expect(pruneArchivedWorkflowPayload(logId)).rejects.toBeInstanceOf(
      ArchivePruneDeferredError
    )
  })
  it('retains original historical inline/control bytes when the actual future reader refuses financial or paused-outcome readiness', async () => {
    const prior = process.env.WORKFLOW_ADMISSIONS_CLOSED
    process.env.WORKFLOW_ADMISSIONS_CLOSED = 'true'
    fixture.historicalFinanceRefusal = true
    const archiveWrite = vi.spyOn(archiveIO, 'writePrivateArchive')
    const terminalId = `historical-terminal-${crypto.randomUUID()}`
    const pausedId = `historical-paused-${crypto.randomUUID()}`
    const actual = {
      content: ' preserved🔥\n ',
      tokens: { total: 7 },
      cost: { total: 1 },
      toolCalls: {
        list: [{ arguments: { fixed: 'actual' }, result: { value: 'actual' } }],
        count: 1,
      },
      toolResults: [{ value: 'actual' }],
    }
    const spans = [
      {
        id: 'old-a',
        blockId: 'a',
        name: 'Agent',
        type: 'agent',
        duration: 3,
        startTime: '2026-01-01',
        endTime: '2026-01-01',
        input: { messages: [{ role: 'system', content: ' exact🔥\n ' }] },
        output: actual,
      },
    ]
    const context: ExecutionContext = createMockContext()
    context.blockStates.set('done', { output: { actual: true }, executed: true, executionTime: 1 })
    context.loopExecutions = new Map([
      ['loop', new Map([['iteration_0', { output: 'completed' }]])],
    ])
    const checkpoint = {
      workflowLogId: pausedId,
      blueprint: { workflowId: null },
      executor: {
        workflow: { blocks: [], connections: [] },
        currentBlockStates: { done: { actual: true } },
        iteration: 2,
        finalOutput: {},
        context: saveExecutionContext(context),
      },
    }
    const encrypted = (await encryptSecret(JSON.stringify(checkpoint))).encrypted
    const storedCheckpoint = {
      revision: 3,
      activeJobId: null,
      encryptedSnapshot: encrypted,
      pausePoints: [
        {
          id: 'pause',
          kind: 'human',
          blockId: 'approval',
          blockName: 'Review',
          displayData: {},
          inputFormat: [],
        },
      ],
    }
    try {
      for (const [id, ended, continuation] of [
        [terminalId, true, undefined],
        [pausedId, false, storedCheckpoint],
      ] as const) {
        const data = {
          environment: { userId: 'archive-owner' },
          traceSpans: spans,
          finalOutput: actual,
          files: ['retained-file'],
          ...(continuation ? { checkpoint: continuation } : {}),
        }
        await fixture.client`insert into workflow_execution_logs (id,workspace_id,execution_id,state_snapshot_id,execution_data,started_at,created_at,ended_at,level,trigger) values (${id},${ws},${id},${snapshotId},${JSON.stringify(data)},now(),now(),${ended ? new Date().toISOString() : null},'info','manual')`
        await expect(
          preserveHistoricalWorkflowPayload(id, async () => {
            throw new Error('protected backup unavailable')
          })
        ).rejects.toThrow('protected backup unavailable')
        const [unchanged] =
          await fixture.client`select execution_data from workflow_execution_logs where id=${id}`
        expect(unchanged.execution_data).toEqual(data)
        const protectSource = async (source: unknown) => {
          await writeFile(path.join(root, `${id}.protected.json`), JSON.stringify(source), {
            mode: 0o600,
            flag: 'wx',
          })
        }
        await expect(preserveHistoricalWorkflowPayload(id, protectSource)).rejects.toThrow(
          /financial binding|paused\/terminal/
        )
        const protectedSource = JSON.parse(
          await readFile(path.join(root, `${id}.protected.json`), 'utf8')
        )
        expect(protectedSource.record.executionData).toEqual(data)
        expect(protectedSource.snapshot.id).toBe(snapshotId)
        // Actual private object IO/readback may finish; an unreferenced object is NOT successful preservation.
        const written = archiveWrite.mock.results.at(-1)
        if (!written || written.type !== 'return')
          throw new Error('Expected completed private archive write')
        const unreferenced = await written.value
        const artifact = await readPrivateArchive(unreferenced)
        expect(artifact.functional.output).toEqual({
          content: actual.content,
          toolCalls: actual.toolCalls,
          toolResults: actual.toolResults,
        })
        const [row] = await fixture.client`select * from workflow_execution_logs where id=${id}`
        expect(row.execution_data).toEqual(data)
        expect(row.execution_data).not.toHaveProperty('preservedFunctionalArchive')
        expect(row.execution_data.traceSpans).toEqual(spans)
        if (continuation) expect(row.execution_data.checkpoint).toEqual(storedCheckpoint)
      }
    } finally {
      archiveWrite.mockRestore()
      fixture.historicalFinanceRefusal = false
      await fixture.client`delete from workflow_execution_logs where id in (${terminalId},${pausedId})`
      if (prior === undefined) Reflect.deleteProperty(process.env, 'WORKFLOW_ADMISSIONS_CLOSED')
      else process.env.WORKFLOW_ADMISSIONS_CLOSED = prior
    }
  })
  it('reauthorizes after private IO and denies removed users/workspace anchors while retained private bytes remain service-only', async () => {
    const [row] = await fixture.db
      .select()
      .from(workflowExecutionLogs)
      .where((await import('drizzle-orm')).eq(workflowExecutionLogs.id, logId))
      .limit(1)
    let authorizations = 0
    await expect(
      hydrateExecutionPayload({ ...row, ...scope }, async () => {
        authorizations++
        if (authorizations === 2) throw new Error('access revoked during IO')
      })
    ).rejects.toThrow('revoked')
    await fixture.client`update workspace set owner_id='different-owner' where id=${ws}`
    await expect(
      hydrateExecutionPayload({ ...row, ...scope }, () =>
        assertRetainedLogAccess(scope, 'archive-owner')
      )
    ).rejects.toThrow('revoked')
    await fixture.client`delete from workspace where id=${ws}`
    await expect(
      hydrateExecutionPayload({ ...row, ...scope }, () =>
        assertRetainedLogAccess(scope, 'archive-owner')
      )
    ).rejects.toThrow('revoked')
    expect((await readPrivateArchive(row.executionData.workflowArchive)).functional.output).toEqual(
      functionalOutput
    )
  })
  it('cold-reads a genuinely completed preaccept response from PostgreSQL and preserves independent failed checkpoint state through archive handoff', async () => {
    const id = `r8-response-log-${crypto.randomUUID()}`
    const execution = `r8-response-execution-${crypto.randomUUID()}`
    const owner = {
      workspaceId: ws,
      logId: id,
      executionId: execution,
      blockId: 'a',
      runId: `r8-response-${crypto.randomUUID()}`,
      actorUserId: 'archive-owner',
    }
    concurrentLogs.push(id)
    await fixture.client`insert into workflow_execution_logs (id,workspace_id,execution_id,state_snapshot_id,execution_data,started_at,created_at,level,trigger) values (${id},${ws},${execution},${snapshotId},${JSON.stringify({ environment: { userId: 'archive-owner' } })},now(),now(),'info','manual')`
    const literal = ' \n```ts\nconst x = "<working_memory>completed 🔥</working_memory>"\n```\t '
    let messages: MastraDBMessage[] = []
    const finance = await financialProcessors(
      {
        actorUserId: 'archive-owner',
        workspaceId: ws,
        runId: owner.runId,
        purpose: 'source-payload',
      },
      ({ readResponse }) => {
        messages = structuredClone(readResponse())
      }
    )
    const source = new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [{ type: 'text', text: literal }],
        finishReason: 'stop',
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        warnings: [],
      }),
    })
    const onStepFinish = vi.fn()
    const agent = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: 'r8-cold-completed-response',
      name: 'Source-only response capture',
      instructions: '',
      model: source,
      inputProcessors: finance.inputProcessors,
      outputProcessors: finance.outputProcessors,
    })
    await expect(
      agent.generate(' exact source-only user🔥\n ', {
        runId: owner.runId,
        maxSteps: 1,
        maxProcessorRetries: 0,
        modelSettings: { maxRetries: 0 },
        onStepFinish,
      })
    ).rejects.toThrow('Synthetic postresponse acceptance rejection')
    expect(onStepFinish).not.toHaveBeenCalled()
    expect(source.doGenerateCalls).toHaveLength(1)
    expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
    expect(messages.flatMap((message) => message.content.parts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: literal })])
    )
    const canonical = await writeFunctionalPayload(owner, {
      selectedMessages: [{ role: 'user', content: ' exact source-only user🔥\n ' }],
      messages,
      output: { error: 'Synthetic postresponse acceptance rejection' },
      tools: [],
    })
    concurrentRefs.push(canonical)
    const checkpoint = {
      executor: {
        context: {
          blockLogs: [
            {
              id: 'lifecycle.storage.test.ts:saved-occurrence:2',
              blockId: 'a',
              success: false,
              inference: { nativePayload: canonical, generatedFields: [] },
              output: { error: 'saved log failure', logOnly: true },
            },
          ],
          blockStates: [
            [
              'a',
              {
                executed: true,
                output: { error: 'saved state failure', status: 500, stateOnly: true },
              },
            ],
          ],
        },
        currentBlockStates: {
          a: { error: 'saved current failure', status: 500, currentOnly: true },
        },
      },
    }
    const encryptedSnapshot = (await encryptSecret(JSON.stringify(checkpoint))).encrypted
    await fixture.client`update workflow_execution_logs set execution_data=${JSON.stringify({ environment: { userId: 'archive-owner' }, functionalPayload: canonical, nativePayloads: { a: canonical }, finalOutput: FUNCTIONAL_OUTPUT_REFERENCE, checkpoint: { encryptedSnapshot } })} where id=${id}`
    // A fresh native store/Memory object must read actual persisted rows, not acquired buffers.
    // This is same-process reopen, not process-restart evidence or monetary acceptance proof.
    await native.close()
    native = createNativeStorage(fixture.url!, true)
    await native.storage.init()
    memory = new Memory({ storage: native.storage, options: PASSIVE_MEMORY_OPTIONS })
    store = (await native.storage.getStore('memory'))!
    vi.mocked(runtime.getNativeMemory).mockResolvedValue(memory)
    vi.mocked(runtime.getNativeMemoryStore).mockResolvedValue(store)
    const payload = await readFunctionalPayload(canonical)
    expect(payload.messages?.flatMap((message) => message.content.parts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: literal })])
    )
    expect(payload.selectedMessages).toEqual([
      { role: 'user', content: ' exact source-only user🔥\n ' },
    ])
    expect(payload.output).toEqual({ error: 'Synthetic postresponse acceptance rejection' })
    const [row] =
      await fixture.client`select execution_data from workflow_execution_logs where id=${id}`
    const cold = JSON.parse(
      (await decryptSecret(row.execution_data.checkpoint.encryptedSnapshot)).decrypted
    )
    await hydrateCheckpointFunctionalPayloads(cold, {
      workspaceId: ws,
      executionId: execution,
      logId: id,
    })
    expect(cold.executor.context.blockLogs[0].output).toEqual({
      error: 'saved log failure',
      logOnly: true,
    })
    expect(cold.executor.context.blockStates[0][1].output).toEqual({
      error: 'saved state failure',
      status: 500,
      stateOnly: true,
    })
    expect(cold.executor.currentBlockStates.a).toEqual({
      error: 'saved current failure',
      status: 500,
      currentOnly: true,
    })
    // Close this synthetic owner before actual immutable archive preparation; no restart/replay.
    await fixture.client`update workflow_execution_logs set execution_data=${JSON.stringify({ environment: { userId: 'archive-owner' }, functionalPayload: canonical, nativePayloads: { a: canonical }, finalOutput: FUNCTIONAL_OUTPUT_REFERENCE })}, ended_at=now() where id=${id}`
    const archive = await prepareWorkflowArchive(id)
    const archived = await readPrivateArchive(archive)
    expect(archived.functional.output).toEqual({
      error: 'Synthetic postresponse acceptance rejection',
    })
    expect(
      archived.nativeThreads
        .flatMap((thread: { messages: MastraDBMessage[] }) => thread.messages)
        .flatMap((message: MastraDBMessage) => message.content.parts)
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: literal })]))
    expect(source.doGenerateCalls).toHaveLength(1)
  })

  it.each(['old-first', 'successor-first'] as const)(
    'keeps the published successor intact when a holder-lost public SAVE commits %s',
    async (order) => {
      const owner = await freshOwner('detached-r9')
      const stages: string[] = []
      const transaction = fixture.db.transaction.bind(fixture.db)
      const publicStore: Awaited<ReturnType<typeof runtime.getNativeMemoryStore>> = store
      const nativeSave = publicStore.saveMessages.bind(publicStore)
      let appPid: number | undefined
      let entered = false
      let callbackSettled = false
      let transactionSelected = false
      let saveSelected = false
      let oldCommitted = false
      let oldMessages: MastraDBMessage[] = []
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let callbackDone!: () => void
      const callbackSettlement = new Promise<void>((resolve) => {
        callbackDone = resolve
      })
      const txSpy = vi
        .spyOn(fixture.db, 'transaction')
        .mockImplementation((run: any, options: any) => {
          if (transactionSelected) return transaction(run, options)
          transactionSelected = true
          return transaction(async (tx: any) => {
            entered = true
            try {
              const [row] = await tx.execute(sql`select pg_backend_pid() as pid`)
              appPid = row.pid
              return await run(tx)
            } finally {
              callbackSettled = true
              callbackDone()
            }
          }, options)
        })
      const saveSpy = vi.spyOn(publicStore, 'saveMessages').mockImplementation(async (args) => {
        if (saveSelected) return nativeSave(args)
        saveSelected = true
        oldMessages = structuredClone(args.messages)
        stages.push('old-public-save:before-delegate')
        await held
        stages.push('old-public-save:delegate-dispatched')
        const result = await nativeSave(args)
        oldCommitted = true
        stages.push('old-public-save:committed-and-acknowledged')
        return result
      })
      let outer: { ref?: NativePayloadRef; error?: unknown } | undefined
      const oldOutcome = writeFunctionalPayload(owner, { output: { incarnation: 'old' } }).then(
        (ref) => (outer = { ref }),
        (error: unknown) => (outer = { error })
      )
      try {
        await vi.waitFor(() => expect(saveSelected).toBe(true))
        expect(appPid).toBeTypeOf('number')
        expect(entered).toBe(true)
        const [termination] =
          await fixture.client`select pg_terminate_backend(${appPid!}) as terminated`
        expect(termination.terminated).toBe(true)
        await vi.waitFor(() => expect(outer?.error).toBeTruthy())
        stages.push('application-holder:terminated-and-outer-rejected')
        expect(callbackSettled).toBe(false)
        expect(oldCommitted).toBe(false)
        if (order === 'old-first') {
          release()
          await callbackSettlement
          expect(oldCommitted).toBe(true)
        }
        const successor = await writeFunctionalPayload(owner, {
          output: { incarnation: 'successor' },
        })
        concurrentRefs.push(successor)
        expect(
          successor.messageIds.every((id) => !oldMessages.some((message) => message.id === id))
        ).toBe(true)
        await fixture.client`update workflow_execution_logs set ended_at=now(),execution_data=${JSON.stringify({ environment: { userId: 'archive-owner' }, functionalPayload: successor, nativePayloads: { current: successor }, finalOutput: FUNCTIONAL_OUTPUT_REFERENCE })} where id=${owner.logId}`
        const readPublished = async () => {
          const [row] =
            await fixture.client`select * from workflow_execution_logs where id=${owner.logId}`
          expect(row.execution_data.functionalPayload).toEqual(successor)
          const restored = await hydrateExecutionPayload(
            { ...row, ...owner, executionData: row.execution_data },
            () => assertRetainedLogAccess(owner, 'archive-owner')
          )
          expect(restored.executionData.finalOutput).toEqual({ incarnation: 'successor' })
          expect((await readFunctionalPayload(successor)).output).toEqual({
            incarnation: 'successor',
          })
        }
        await readPublished()
        stages.push('successor:published-and-read')
        if (order === 'successor-first') {
          release()
          await callbackSettlement
          expect(oldCommitted).toBe(true)
        }
        await oldOutcome
        expect(outer?.ref).toBeUndefined()
        expect(callbackSettled).toBe(true)
        const storedOld = await store.listMessagesById({
          messageIds: oldMessages.map(({ id }) => id),
        })
        expect(storedOld.messages.map((message: MastraDBMessage) => message.id).sort()).toEqual(
          oldMessages.map(({ id }) => id).sort()
        )
        await readPublished()
        await expect(prepareWorkflowArchive(owner.logId)).rejects.toThrow(
          /Unreferenced|classification/
        )
        console.info(
          JSON.stringify({
            kind: 'R9_HISTORY_HOLDER_LOSS',
            order,
            stages,
            oldSaveReallyCommitted: oldCommitted,
            trackedCallbackSettled: callbackSettled,
            originalOuterRejected: Boolean(outer?.error),
            successorDigestUnchanged: true,
            archiveDeferredUnknownCandidate: true,
            sqlAlreadyInflightAtGate: false,
          })
        )
      } finally {
        release()
        await oldOutcome
        if (entered) await callbackSettlement
        txSpy.mockRestore()
        saveSpy.mockRestore()
      }
    }
  )

  it('confirms a real native commit with a lost SAVE acknowledgement using the same candidate', async () => {
    const owner = await freshOwner('ack-r9')
    const publicStore: Awaited<ReturnType<typeof runtime.getNativeMemoryStore>> = store
    const save = publicStore.saveMessages.bind(publicStore)
    let ids: string[] = []
    const spy = vi.spyOn(publicStore, 'saveMessages').mockImplementationOnce(async (args) => {
      ids = args.messages.map(({ id }) => id)
      await save(args)
      throw new Error('Synthetic acknowledgement loss AFTER actual public native commit')
    })
    try {
      const candidate = await writeFunctionalPayload(owner, { output: { exact: 'committed once' } })
      concurrentRefs.push(candidate)
      expect(spy).toHaveBeenCalledOnce()
      expect(candidate.messageIds).toEqual(ids)
      expect((await readFunctionalPayload(candidate)).output).toEqual({ exact: 'committed once' })
    } finally {
      spy.mockRestore()
    }
  })

  it('uses actual SQL completion CAS winner references and emits no losing output', async () => {
    const owner = await freshOwner('__execution__')
    const logger = new ExecutionLogger()
    const settle = vi.spyOn(logger, 'settleWorkflowExecutionUsage').mockResolvedValue(undefined)
    const actualWrite = history.writeFunctionalPayload
    let held = false
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let losingRef: NativePayloadRef | undefined
    const spy = vi
      .spyOn(history, 'writeFunctionalPayload')
      .mockImplementation(async (scope, payload) => {
        const ref = await actualWrite(scope, payload)
        if (!held) {
          held = true
          losingRef = ref
          await barrier
        }
        return ref
      })
    const params = {
      executionId: owner.executionId,
      workflowLogId: owner.logId,
      workspaceId: owner.workspaceId,
      endedAt: new Date().toISOString(),
      totalDurationMs: 1,
      success: true,
      billable: false,
    }
    const first = logger.completeWorkflowExecution({
      ...params,
      finalOutput: { answer: 'losing A' },
    })
    const firstOutcome = first.then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    )
    try {
      await vi.waitFor(() => expect(held).toBe(true))
      const winner = await logger.completeWorkflowExecution({
        ...params,
        success: false,
        finalOutput: { answer: 'winning B', status: 500 },
      })
      const [published] =
        await fixture.client`select execution_data from workflow_execution_logs where id=${owner.logId}`
      const winningReference = published.execution_data.functionalPayload as NativePayloadRef
      concurrentRefs.push(winningReference)
      release()
      const outcome = await firstOutcome
      expect(outcome).not.toHaveProperty('error')
      if (!('result' in outcome)) throw outcome.error
      expect(outcome.result.executionData.finalOutput).toEqual(winner.executionData.finalOutput)
      expect(outcome.result.executionData).toMatchObject({ functionalPayload: winningReference })
      expect(winningReference).not.toEqual(losingRef)
      expect(outcome.result.level).toBe('error')
      expect(outcome.result.cost.status).toBe('unavailable')
      const emissions = fixture.emissions.filter((entry) => entry.executionId === owner.executionId)
      expect(emissions).toHaveLength(2)
      expect(
        emissions.every((entry) => entry.executionData.finalOutput.answer === 'winning B')
      ).toBe(true)
    } finally {
      release()
      await firstOutcome
      spy.mockRestore()
      settle.mockRestore()
    }
  })

  it('returns the actual competing checkpoint revision and preserves the winning snapshot/reference', async () => {
    const owner = await freshOwner('__checkpoint__')
    const settle = vi
      .spyOn(executionLogger, 'settleWorkflowExecutionUsage')
      .mockResolvedValue(undefined)
    const actualWrite = history.writeFunctionalPayload
    let held = false
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    let losingRef: NativePayloadRef | undefined
    const spy = vi
      .spyOn(history, 'writeFunctionalPayload')
      .mockImplementation(async (scope, payload) => {
        const ref = await actualWrite(scope, payload)
        if (!held) {
          held = true
          losingRef = ref
          await barrier
        }
        return ref
      })
    const snapshot = {
      executor: {
        currentBlockStates: {},
        context: { blockStates: [], blockLogs: [], metadata: { duration: 1 } },
      },
      blueprint: { workflowId: owner.workflowId },
      workflowLogId: owner.logId,
    } as any
    const args = {
      executionId: owner.executionId,
      workflowId: owner.workflowId,
      workspaceId: owner.workspaceId,
      userId: 'archive-owner',
      snapshot,
      pausePoints: [
        {
          id: 'first',
          blockId: 'pause',
          blockName: 'Pause',
          kind: 'human' as const,
          displayData: {},
          inputFormat: [],
        },
      ],
    }
    const first = saveWorkflowCheckpoint(args).then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    )
    try {
      await vi.waitFor(() => expect(held).toBe(true))
      const winner = await saveWorkflowCheckpoint({
        ...args,
        pausePoints: [{ ...args.pausePoints[0], id: 'winning' }],
      })
      const [before] =
        await fixture.client`select execution_data from workflow_execution_logs where id=${owner.logId}`
      concurrentRefs.push(before.execution_data.functionalPayload)
      release()
      const outcome = await first
      expect(outcome).not.toHaveProperty('error')
      if (!('result' in outcome)) throw outcome.error
      expect(outcome.result).toEqual(winner)
      expect(winner.revision).toBe(1)
      expect(winner.pausePoints[0].id).toBe('winning')
      const [after] =
        await fixture.client`select execution_data from workflow_execution_logs where id=${owner.logId}`
      expect(after.execution_data).toEqual(before.execution_data)
      expect(after.execution_data.functionalPayload).not.toEqual(losingRef)
      const restored = JSON.parse(
        (await decryptSecret(after.execution_data.checkpoint.encryptedSnapshot)).decrypted
      )
      expect(restored).toEqual(snapshot)
    } finally {
      release()
      await first
      spy.mockRestore()
      settle.mockRestore()
    }
  })
  it('keeps trusted failure reports live and only functional copies through native payload, encrypted checkpoint and cold archive', async () => {
    const owner = await freshOwner('a')
    const business = {
      model: 'business-model',
      tokens: { total: 9999 },
      cost: { inventory: 42 },
      inference: { tokens: 'literal' },
      toolResults: ['ordinary business data'],
    }
    const facts = {
      model: 'native/failure',
      tokens: { prompt: 8, completion: 9, total: 17 },
      cost: { status: 'unavailable' as const },
      toolCost: 0,
      generatedFields: ['model', 'tokens', 'cost', 'toolCost'],
    }
    const failure = withInferenceFacts(
      Object.assign(new Error('Original refusal'), {
        model: facts.model,
        tokens: facts.tokens,
        cost: facts.cost,
        toolCost: 0,
        business,
      }),
      facts
    )
    const output = withInferenceFacts(
      {
        error: 'Original refusal',
        status: 500,
        model: facts.model,
        tokens: facts.tokens,
        cost: facts.cost,
        toolCost: 0,
        business,
      },
      facts
    )
    const tools = [
      { success: false, error: 'Original refusal', toolCallId: 'failed-r10', result: failure },
      { success: true, toolCallId: 'business-r10', result: business },
    ]
    const saves = vi.spyOn(store, 'saveMessages')
    try {
      const ref = await writeFunctionalPayload(owner, {
        selectedMessages: [{ role: 'user', content: 'literal input' }],
        messages: [
          {
            id: 'native-r10-response',
            role: 'assistant',
            createdAt: new Date(),
            content: { format: 2, parts: [{ type: 'text', text: 'known completed answer' }] },
          },
        ],
        output,
        tools,
      })
      concurrentRefs.push(ref)
      const payload = await readFunctionalPayload(ref)
      expect(payload.output).toEqual({
        error: 'Original refusal',
        status: 500,
        model: facts.model,
        business,
      })
      expect(payload.toolResultIndexes).toEqual([0, 1])
      if (!Array.isArray(payload.tools)) throw new Error('Expected exact functional tool list')
      expect(payload.tools[0]).toMatchObject({
        success: false,
        error: 'Original refusal',
        result: {
          name: 'Error',
          message: 'Original refusal',
          model: facts.model,
          business,
        },
      })
      expect(payload.tools[1].result).toEqual(business)
      expect(JSON.stringify(payload)).not.toContain('"total":17')
      expect(failure.tokens.total).toBe(17)
      expect(getInferenceFacts(failure)).toBe(facts)
      const context: ExecutionContext = createMockContext()
      context.blockLogs = [
        {
          id: 'lifecycle.storage.test.ts:saved-occurrence:3',
          blockId: 'a',
          blockType: 'agent',
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: 1,
          success: false,
          error: 'Original refusal',
          output: withInferenceFacts({ ...output, logOnly: true }, facts),
          inference: { ...facts, nativePayload: ref },
        },
      ]
      context.blockStates.set('a', {
        output: withInferenceFacts({ ...output, stateOnly: true }, facts),
        success: false,
        executed: true,
        executionTime: 1,
      })
      const currentOutput: NormalizedBlockOutput = withInferenceFacts(
        { ...output, currentOnly: 'current-destination' },
        facts
      )
      const snapshot = {
        executor: finalizeExecutorCheckpoint({
          workflow: context.workflow!,
          iteration: 1,
          context: saveExecutionContext(context),
          currentBlockStates: { a: currentOutput },
          finalOutput: output,
        }),
        blueprint: { workflowId: owner.workflowId },
        workflowLogId: owner.logId,
      }
      const encryptedSnapshot = (await encryptSecret(JSON.stringify(snapshot))).encrypted
      await fixture.client`update workflow_execution_logs set execution_data=${JSON.stringify({ environment: { userId: 'archive-owner' }, functionalPayload: ref, nativePayloads: { a: ref }, finalOutput: FUNCTIONAL_OUTPUT_REFERENCE, checkpoint: { encryptedSnapshot } })} where id=${owner.logId}`
      await native.close()
      native = createNativeStorage(fixture.url!, true)
      await native.storage.init()
      memory = new Memory({ storage: native.storage, options: PASSIVE_MEMORY_OPTIONS })
      store = (await native.storage.getStore('memory'))!
      vi.mocked(runtime.getNativeMemory).mockResolvedValue(memory)
      vi.mocked(runtime.getNativeMemoryStore).mockResolvedValue(store)
      expect((await readFunctionalPayload(ref)).output).toEqual(payload.output)
      const [row] =
        await fixture.client`select execution_data from workflow_execution_logs where id=${owner.logId}`
      const cold = JSON.parse(
        (await decryptSecret(row.execution_data.checkpoint.encryptedSnapshot)).decrypted
      )
      expect(JSON.stringify(cold)).not.toContain('"total":17')
      await hydrateCheckpointFunctionalPayloads(cold, owner)
      expect(cold.executor.context.blockLogs[0].output).toMatchObject({
        status: 500,
        logOnly: true,
        business,
      })
      expect(cold.executor.context.blockStates[0][1]).toMatchObject({
        success: false,
        executed: true,
        executionTime: 1,
        output: { status: 500, stateOnly: true, business },
      })
      expect(cold.executor.currentBlockStates.a).toMatchObject({
        status: 500,
        currentOnly: 'current-destination',
        business,
      })
      expect(cold.executor.finalOutput).toEqual(payload.output)
      expect(JSON.stringify(cold)).not.toContain('"total":17')
      await fixture.client`update workflow_execution_logs set ended_at=now(),execution_data=${JSON.stringify({ environment: { userId: 'archive-owner' }, functionalPayload: ref, nativePayloads: { a: ref }, finalOutput: FUNCTIONAL_OUTPUT_REFERENCE })} where id=${owner.logId}`
      const archive = await prepareWorkflowArchive(owner.logId)
      expect((await readPrivateArchive(archive)).functional.output).toEqual(payload.output)
      expect(saves).toHaveBeenCalledTimes(1)
    } finally {
      saves.mockRestore()
    }
  })
})
