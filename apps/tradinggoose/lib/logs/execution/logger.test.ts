/** @vitest-environment node */
import { db } from '@tradinggoose/db'
import { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateFunctionalBlocks, projectFunctionalBlocks } from '@/lib/workflow-archive/functional'
import { ExecutionLogger } from './logger'

const state = vi.hoisted(() => ({
  row: null as Record<string, any> | null,
  insertFailure: false,
  nativeFailure: false,
  financeFailure: false,
  payloads: new Map<string, unknown>(),
  write: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  admit: vi.fn(),
  accept: vi.fn(),
  verify: vi.fn(),
  emit: vi.fn(),
  snapshot: vi.fn(),
}))
const binding = {
  namespace: 'billing-usage:user:original-payer',
  key: 'invocation:execution',
  fingerprint: 'original-financial-identity',
  runId: 'execution',
  actorUserId: 'actor',
  workspaceId: 'workspace',
  workflowId: 'workflow',
  purpose: 'workflow-execution',
}
const ref = {
  version: 1,
  purpose: 'workflow-agent',
  workspaceId: 'workspace',
  executionId: 'execution',
  logId: 'log',
  blockId: '__execution__',
  runId: 'completion',
  resourceId: 'native-resource',
  threadId: 'native-thread',
  messageIds: ['native-payload'],
  digest: 'verified-digest',
}
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  acceptModelStep: state.accept,
}))
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: state.create,
  admitFinancialModelStep: state.admit,
  verifyFinancialAcceptance: state.verify,
}))
vi.mock('@/lib/mastra/workflow-history', () => ({
  writeFunctionalPayload: state.write,
  readFunctionalPayload: state.read,
}))
vi.mock('@/lib/logs/events', () => ({ emitWorkflowExecutionCompleted: state.emit }))
vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: { createSnapshotWithDeduplication: state.snapshot },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))
vi.mock('@tradinggoose/db', () => {
  const query = (update?: Record<string, any>, inserting = false) => {
    let condition: SQL | undefined
    const run = () => {
      if (inserting) {
        if (state.insertFailure) {
          state.insertFailure = false
          throw new Error('initial log insert unavailable')
        }
        if (state.row) return []
        state.row = { ...update, createdAt: new Date('2026-11-08T10:00:00Z') }
        return [state.row]
      }
      if (!state.row) return []
      const filter = condition && new PgDialect().sqlToQuery(condition).sql
      if (update && filter?.includes('"ended_at" is null') && state.row.endedAt) return []
      if (update)
        for (const [key, value] of Object.entries(update)) {
          if (value instanceof SQL && key === 'executionData') {
            const params = new PgDialect().sqlToQuery(value).params
            const patch = JSON.parse(params[0] as string)
            const billable = JSON.parse(params[1] as string)
            const data = {
              ...state.row.executionData,
              ...patch,
              billing: { ...state.row.executionData.billing, ...billable },
            }
            for (const obsolete of [
              'checkpoint',
              'pause',
              'traceSpans',
              'tokenBreakdown',
              'models',
            ])
              delete data[obsolete]
            state.row.executionData = data
          } else state.row[key] = value
        }
      return [state.row]
    }
    const chain = {
      from: (_table: unknown) => chain,
      where: (value: SQL) => {
        condition = value
        return chain
      },
      limit: () => chain,
      returning: () => chain,
      onConflictDoNothing: () => chain,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    }
    return chain
  }
  const connection = {
    select: () => query(),
    insert: () => ({ values: (value: Record<string, any>) => query(value, true) }),
    update: () => ({ set: (value: Record<string, any>) => query(value) }),
  }
  return {
    db: {
      ...connection,
      transaction: (callback: (tx: typeof connection) => Promise<unknown>) => callback(connection),
    },
  }
})

const span = {
  id: 'agent-occurrence',
  name: 'Agent',
  type: 'agent',
  blockId: 'agent-block',
  duration: 1000,
  startTime: '2026-11-08T10:00:00Z',
  endTime: '2026-11-08T10:00:01Z',
  status: 'success' as const,
  input: { message: 'selected input' },
  output: { answer: 'functional answer' },
  model: 'openai/gpt-4.1',
  cost: { status: 'unavailable' as const },
  tokens: { prompt: 10, completion: 3, total: 13 },
  inference: {
    model: 'openai/gpt-4.1',
    tokens: { prompt: 10, completion: 3, total: 13 },
    cost: { status: 'unavailable' as const },
    generatedFields: [],
  },
}
const completion = {
  executionId: 'execution',
  workflowLogId: 'log',
  workspaceId: 'workspace',
  endedAt: '2026-11-08T10:00:01Z',
  totalDurationMs: 1000,
  finalOutput: { answer: 'functional answer' },
  success: true,
  traceSpans: [span],
}
let logger: ExecutionLogger
beforeEach(() => {
  vi.clearAllMocks()
  state.insertFailure = state.nativeFailure = state.financeFailure = false
  state.payloads.clear()
  state.row = {
    id: 'log',
    executionId: 'execution',
    workflowId: 'workflow',
    workspaceId: 'workspace',
    stateSnapshotId: 'snapshot',
    workflowSummary: { id: 'workflow' },
    level: 'info',
    trigger: 'api',
    startedAt: new Date('2026-11-08T10:00:00Z'),
    createdAt: new Date('2026-11-08T10:00:00Z'),
    endedAt: null,
    totalDurationMs: null,
    executionData: {
      environment: {
        userId: 'actor',
        workflowId: 'workflow',
        workspaceId: 'workspace',
        executionId: 'execution',
        variables: { old: 'value' },
      },
      billing: { binding },
      checkpoint: { revision: 1 },
      pause: { revision: 1 },
      traceSpans: [span],
      tokenBreakdown: { total: 13 },
      models: { old: {} },
      untouched: 'keep',
    },
  }
  state.create.mockResolvedValue(binding)
  state.admit.mockResolvedValue(undefined)
  state.accept.mockImplementation(async () => {
    if (state.financeFailure) throw new Error('shared financial acceptance unavailable')
    return { appliedUsd: '0.30000000000000001' }
  })
  state.verify.mockResolvedValue({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
  state.emit.mockResolvedValue(undefined)
  state.snapshot.mockResolvedValue({
    snapshot: { id: 'snapshot', stateHash: 'state-hash', stateData: {} },
  })
  state.write.mockImplementation(async (scope, payload) => {
    if (state.nativeFailure) throw new Error('canonical native readback unavailable')
    if (state.row?.endedAt) throw new Error('Workflow payload writer is closed')
    if (scope.executionId !== state.row?.executionId || scope.logId !== state.row?.id)
      throw new Error('Wrong canonical scope')
    state.payloads.set('completion', structuredClone(payload))
    return ref
  })
  state.read.mockImplementation(
    async (reference) => state.payloads.get(reference.digest) ?? state.payloads.get('completion')
  )
  logger = new ExecutionLogger()
})

describe('canonical workflow result and independent shared financial acceptance', () => {
  it('emits the actual completion CAS winner rather than its losing native candidate', async () => {
    const winningRef = { ...ref, digest: 'winning-reference', messageIds: ['winning-message'] }
    const winningOutput = { answer: 'actual retained winner', status: 500 }
    state.write.mockImplementationOnce(async () => {
      state.payloads.set(winningRef.digest, { output: winningOutput, blocks: [] })
      state.row = {
        ...state.row!,
        level: 'error',
        endedAt: new Date('2026-11-08T10:00:03Z'),
        totalDurationMs: 3000,
        executionData: {
          ...state.row!.executionData,
          functionalPayload: winningRef,
          nativePayloads: { completion: winningRef },
          finalOutput: { purpose: 'workflow-functional-output', version: 1 },
        },
      }
      return { ...ref, digest: 'losing-reference', messageIds: ['losing-message'] }
    })
    const result = await logger.completeWorkflowExecution(completion)
    expect(state.read).toHaveBeenCalledWith(winningRef)
    expect(result.executionData.finalOutput).toEqual(winningOutput)
    expect(result.executionData.traceSpans).toEqual([])
    expect(result.level).toBe('error')
    expect(result.totalDurationMs).toBe(3000)
    expect(result.cost.status).toBe('unavailable')
    expect(state.emit).toHaveBeenCalledExactlyOnceWith(result)
    expect(JSON.stringify(state.emit.mock.calls)).not.toContain('losing-reference')
  })
  it('settles only the pinned original binding using the caller transaction, never trace costs', async () => {
    state.row!.executionData.traceSpans = [{ cost: { total: 999999 }, tokens: { total: 999999 } }]
    const result = await db.transaction((tx) =>
      logger.settleWorkflowExecutionUsage('execution', tx)
    )
    expect(result).toEqual({ binding, appliedUsd: '0.30000000000000001' })
    expect(state.accept).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ select: expect.any(Function) }),
      binding,
      { stepNumber: 0, retryCount: 0 },
      { executionTrigger: 'api' }
    )
    expect(state.create).not.toHaveBeenCalled()
    expect(state.admit).not.toHaveBeenCalled()
  })
  it.each(['missing', 'run', 'workspace'])(
    'rejects a %s original binding before financial posting',
    async (kind) => {
      state.row!.executionData.billing.binding =
        kind === 'missing'
          ? undefined
          : { ...binding, [kind === 'run' ? 'runId' : 'workspaceId']: 'wrong' }
      await expect(logger.settleWorkflowExecutionUsage('execution')).rejects.toThrow(
        'Original workflow financial binding'
      )
      expect(state.accept).not.toHaveBeenCalled()
    }
  )
  it.each([true, false])(
    'persists canonical functional references and live terminal result (success=%s)',
    async (success) => {
      const result = await logger.completeWorkflowExecution({
        ...completion,
        success,
        billable: success,
        variables: { next: 'value' },
        failureReason: success ? undefined : 'cancelled',
        hasResponseBlock: true,
      })
      expect(state.write).toHaveBeenCalledExactlyOnceWith(
        {
          workspaceId: 'workspace',
          executionId: 'execution',
          logId: 'log',
          blockId: '__execution__',
          runId: 'completion',
          actorUserId: 'actor',
        },
        {
          blocks: expect.arrayContaining([
            expect.objectContaining({ id: span.id, input: span.input, output: span.output }),
          ]),
          output: completion.finalOutput,
        }
      )
      expect(state.row).toMatchObject({
        endedAt: new Date(completion.endedAt),
        level: success ? 'info' : 'error',
        cost: null,
      })
      expect(state.row!.executionData).toMatchObject({
        functionalPayload: ref,
        finalOutput: { purpose: 'workflow-functional-output', version: 1 },
        untouched: 'keep',
        environment: { userId: 'actor', variables: { next: 'value' } },
      })
      for (const obsolete of ['checkpoint', 'pause', 'traceSpans', 'tokenBreakdown', 'models'])
        expect(state.row!.executionData).not.toHaveProperty(obsolete)
      expect(result.executionData).toMatchObject({
        finalOutput: completion.finalOutput,
        traceSpans: [span],
      })
      expect(result.cost).toMatchObject({ status: 'unavailable', tokens: { total: 13 } })
      expect(state.emit).toHaveBeenCalledExactlyOnceWith(result)
      expect(state.accept).toHaveBeenCalledWith(expect.anything(), binding, expect.anything(), {
        executionTrigger: 'api',
      })
    }
  )
  it('refuses terminal publication when canonical payload/readback failed', async () => {
    state.nativeFailure = true
    await expect(logger.completeWorkflowExecution(completion)).rejects.toThrow(
      'canonical native readback'
    )
    expect(state.row!.endedAt).toBeNull()
    expect(state.row!.executionData.checkpoint).toEqual({ revision: 1 })
    expect(state.accept).not.toHaveBeenCalled()
    expect(state.emit).not.toHaveBeenCalled()
  })
  it('preserves terminal payload through finance outage and retries finance without rewriting native payload', async () => {
    state.financeFailure = true
    await expect(logger.completeWorkflowExecution(completion)).rejects.toThrow(
      'shared financial acceptance'
    )
    expect(state.row!.endedAt).toEqual(new Date(completion.endedAt))
    expect(state.row!.executionData.functionalPayload).toEqual(ref)
    expect(state.payloads.get('completion')).toMatchObject({ output: completion.finalOutput })
    expect(state.emit).not.toHaveBeenCalled()
    expect(state.verify).not.toHaveBeenCalled()
    state.financeFailure = false
    const result = await logger.completeWorkflowExecution({ ...completion, totalDurationMs: 9999 })
    expect(result.totalDurationMs).toBe(1000)
    expect(result.cost).toMatchObject({ status: 'unavailable' })
    expect(result.cost.total).toBeUndefined()
    expect(state.write).toHaveBeenCalledOnce()
    expect(state.emit).toHaveBeenCalledOnce()
    expect(state.accept).toHaveBeenCalledTimes(2)
  })
  it('does not publish a terminal result until read-only canonical acceptance also verifies', async () => {
    state.verify.mockRejectedValueOnce(new Error('accepted receipt unavailable'))
    await expect(logger.completeWorkflowExecution(completion)).rejects.toThrow(
      'accepted receipt unavailable'
    )
    expect(state.row!.endedAt).toEqual(new Date(completion.endedAt))
    expect(state.emit).not.toHaveBeenCalled()
    await logger.completeWorkflowExecution(completion)
    await logger.completeWorkflowExecution(completion)
    expect(state.write).toHaveBeenCalledOnce()
    expect(state.accept).toHaveBeenCalledTimes(3)
    expect(state.verify).toHaveBeenCalledTimes(3)
    // Actual emitter coalesces these attempts through its deterministic delivery PK.
    expect(state.emit).toHaveBeenCalledTimes(2)
  })
  it('retains unique file references from functional input/output without diagnostic payloads', async () => {
    const file = {
      id: 'file-1',
      name: 'result.txt',
      url: 'https://files.example.invalid/result.txt',
      key: 'uploads/result.txt',
      size: 42,
      type: 'text/plain',
      uploadedAt: '2026-11-08T10:00:00Z',
      expiresAt: '2026-11-09T10:00:00Z',
    }
    await logger.completeWorkflowExecution({
      ...completion,
      finalOutput: { files: [file, file] },
      workflowInput: { attachments: [file] },
    })
    expect(state.row!.files).toHaveLength(1)
    expect(state.row!.files[0]).toMatchObject(file)
  })
})

describe('workflow start', () => {
  const start = {
    workflowId: 'workflow',
    executionId: 'execution',
    trigger: { type: 'api' as const, source: 'test', timestamp: '2026-11-08T10:00:00Z' },
    environment: {
      userId: 'actor',
      workspaceId: 'workspace',
      workflowId: 'workflow',
      executionId: 'execution',
      variables: {},
    },
    workflowState: { blocks: {}, edges: [], loops: {}, parallels: {} } as any,
    workflowSummary: { id: 'workflow', name: 'Test workflow' } as any,
  }
  it.each([undefined, false])(
    'pins admission billability before starting its canonical log (%s)',
    async (billable) => {
      state.row = null
      const result = await logger.startWorkflowExecution({
        ...start,
        ...(billable !== undefined && { billable }),
      })
      expect(state.create).toHaveBeenCalledExactlyOnceWith({
        actorUserId: 'actor',
        workspaceId: 'workspace',
        workflowId: 'workflow',
        runId: 'execution',
        purpose: 'workflow-execution',
        operationKey: 'execution',
        billable: billable ?? true,
      })
      expect(state.admit).toHaveBeenCalledExactlyOnceWith(binding, { stepNumber: 0, retryCount: 0 })
      expect(result.workflowLog.executionData).toMatchObject({ billing: { binding } })
      expect(result.workflowLog.executionData).not.toHaveProperty('traceSpans')
    }
  )
  it('preserves a failed start with financial identity and no invented functional transcript', async () => {
    state.row = null
    state.insertFailure = true
    await expect(logger.startWorkflowExecution(start)).rejects.toThrow(
      'initial log insert unavailable'
    )
    expect(state.row).toMatchObject({
      level: 'error',
      totalDurationMs: 0,
      executionData: { billing: { binding }, errorMessage: 'initial log insert unavailable' },
    })
    expect(state.row!.executionData).not.toHaveProperty('traceSpans')
    expect(state.row!.executionData).not.toHaveProperty('finalOutput')
    expect(state.write).not.toHaveBeenCalled()
  })
})

it('preserves every saved occurrence through terminal retries without another native write', async () => {
  const first = { ...span, id: 'saved-first', output: { value: 0 } }
  const second = { ...span, id: 'saved-second', output: { value: 1 } }
  const params = { ...completion, traceSpans: [first, second] }
  const expectedBlocks = projectFunctionalBlocks(params.traceSpans)
  const expectedRetainedSpans = await hydrateFunctionalBlocks(
    JSON.parse(JSON.stringify(expectedBlocks))
  )
  const initial = await logger.completeWorkflowExecution(params)
  const repeated = await logger.completeWorkflowExecution(params)
  expect(initial.executionData.traceSpans).toStrictEqual(params.traceSpans)
  expect(
    initial.executionData.traceSpans?.map(({ id, output }) => ({
      id,
      output,
    }))
  ).toEqual([
    { id: first.id, output: first.output },
    { id: second.id, output: second.output },
  ])
  expect(
    initial.executionData.traceSpans?.map(({ model, inference, tokens, cost }) => ({
      model,
      inference,
      tokens,
      cost,
    }))
  ).toStrictEqual(
    [first, second].map(({ model, inference, tokens, cost }) => ({
      model,
      inference,
      tokens,
      cost,
    }))
  )
  expect(repeated.executionData.traceSpans).toStrictEqual(expectedRetainedSpans)
  expect(projectFunctionalBlocks(repeated.executionData.traceSpans ?? [])).toStrictEqual(
    expectedBlocks
  )
  expect(repeated.executionData.finalOutput).toStrictEqual(initial.executionData.finalOutput)
  for (const retained of repeated.executionData.traceSpans ?? []) {
    for (const field of ['inference', 'model', 'tokens', 'cost']) {
      expect(retained).not.toHaveProperty(field)
    }
  }
  expect(repeated.cost).toStrictEqual({ status: 'unavailable', tokens: {}, models: {} })
  expect(state.write).toHaveBeenCalledOnce()
  expect(state.payloads.get('completion')).toStrictEqual({
    blocks: expectedBlocks,
    output: params.finalOutput,
  })
  expect(expectedBlocks.map(({ id }) => id)).toEqual([first.id, second.id])
  expect(state.emit).toHaveBeenCalledTimes(2)
  expect(state.emit).toHaveBeenNthCalledWith(1, initial)
  expect(state.emit).toHaveBeenNthCalledWith(2, repeated)
})
it('refuses duplicate functional IDs before persisting or publishing an unreadable terminal payload', async () => {
  await expect(
    logger.completeWorkflowExecution({
      ...completion,
      traceSpans: [span, { ...span, output: { earlier: 'must not disappear' } }],
    })
  ).rejects.toThrow('functional block occurrence')
  expect(state.write).not.toHaveBeenCalled()
  expect(state.emit).not.toHaveBeenCalled()
  expect(state.row!.endedAt).toBeNull()
})
