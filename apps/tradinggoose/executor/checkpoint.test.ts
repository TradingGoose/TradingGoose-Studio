import { describe, expect, it, vi } from 'vitest'
import {
  copyWorkflowMessageSource,
  getWorkflowMessageSource,
  workflowMessageDigest,
} from '@/lib/mastra/messages'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import { workflowMemoryIdentity } from '@/lib/mastra/workflow-memory'
import { attachWorkflowMessageSource } from '@/lib/mastra/workflow-message-source'
import { createMinimalWorkflow, createMockContext } from '@/executor/__test-utils__/executor-mocks'
import {
  checkpointFunctionalOutput,
  finalizeExecutorCheckpoint,
  restoreExecutionContext,
  saveExecutionContext,
} from '@/executor/checkpoint'
import type { ExecutionContext } from '@/executor/types'

describe('Executor checkpoint JSON round trip', () => {
  it('restores routing, loop, parallel, variable and block state without runtime callbacks', () => {
    const context: ExecutionContext = {
      ...createMockContext(),
      userId: 'actor',
      executionId: 'execution',
      triggerBlockId: 'trigger',
      environmentVariables: { SECRET: 'encrypted with the checkpoint' },
      workflowVariables: { counter: { name: 'counter', type: 'number', value: 3 } },
      blockStates: new Map([
        ['upstream', { output: { value: 9 }, executed: true, executionTime: 1 }],
      ]),
      decisions: {
        router: new Map([['router', 'yes']]),
        condition: new Map([['condition', 'true']]),
      },
      loopIterations: new Map([['loop', 2]]),
      loopItems: new Map([['loop', { currentItem: 'second', index: 1 }]]),
      executedBlocks: new Set(['upstream']),
      activeExecutionPath: new Set(['approval']),
      completedLoops: new Set(['previous-loop']),
      loopExecutions: new Map([['loop', new Map([['iteration_0', { result: 'first' }]])]]),
      parallelExecutions: new Map([
        [
          'parallel',
          {
            parallelCount: 2,
            distributionItems: ['a', 'b'],
            completedExecutions: 1,
            executionResults: new Map([['0', { approved: true }]]),
            activeIterations: new Set([1]),
            currentIteration: 1,
            parallelType: 'collection',
          },
        ],
      ]),
      parallelBlockMapping: new Map([
        [
          'approval_parallel_parallel_iteration_1',
          {
            originalBlockId: 'approval',
            parallelId: 'parallel',
            iterationIndex: 1,
          },
        ],
      ]),
      onExecutionEvent: vi.fn(),
      shouldCancelExecution: vi.fn(),
      pausePoints: [],
      resumeInputs: new Map([['approval', { approved: true }]]),
    }
    context.metadata.context = context
    const saved = saveExecutionContext(context)
    expect(saved).not.toHaveProperty('workflow')
    expect(saved).not.toHaveProperty('onExecutionEvent')
    expect(saved).not.toHaveProperty('shouldCancelExecution')
    expect(saved).not.toHaveProperty('resumeInputs')
    expect(saved.metadata).not.toHaveProperty('context')
    const restored = restoreExecutionContext(JSON.parse(JSON.stringify(saved)))
    for (const key of [
      'blockStates',
      'decisions',
      'loopIterations',
      'loopItems',
      'executedBlocks',
      'activeExecutionPath',
      'completedLoops',
      'loopExecutions',
      'parallelExecutions',
      'parallelBlockMapping',
      'workflowVariables',
      'environmentVariables',
    ] as const) {
      expect(restored[key]).toEqual(context[key])
    }
    expect(restored.pausePoints).toEqual([])
    expect(restored.resumeInputs).toEqual(new Map())
    expect(restored.userId).toBe('actor')
    expect(restored.executionId).toBe('execution')
  })
  it('retains native payload correlation and structured business values while dropping automatic report envelopes', () => {
    const automatic = withInferenceFacts(
      {
        content: 'answer',
        model: 'native/model',
        tokens: { total: 42 },
        cost: { status: 'unavailable' },
      },
      {
        model: 'native/model',
        tokens: { total: 42 },
        cost: { status: 'unavailable' },
        generatedFields: ['model', 'tokens', 'cost'],
      }
    )
    const structured = withInferenceFacts(
      {
        model: 'business model',
        tokens: 9,
        cost: { business: true },
        nested: { inference: 'literal' },
      },
      { model: 'native/model', tokens: { total: 42 }, generatedFields: [] }
    )
    const context: ExecutionContext = createMockContext()
    context.blockStates = new Map([
      ['automatic', { output: automatic, executed: true, executionTime: 1 }],
      ['structured', { output: structured, executed: true, executionTime: 1 }],
    ])
    context.blockLogs = [
      {
        id: 'checkpoint.test.ts:saved-occurrence:1',
        blockId: 'automatic',
        startedAt: 'start',
        endedAt: 'end',
        durationMs: 1,
        success: true,
        output: automatic,
        inference: {
          model: 'native/model',
          tokens: { total: 42 },
          cost: { status: 'unavailable' },
          generatedFields: ['model', 'tokens', 'cost'],
        },
      },
    ]
    const saved = saveExecutionContext(context)
    expect(saved.blockLogs[0].inference).toEqual({
      model: 'native/model',
      generatedFields: ['model', 'tokens', 'cost'],
    })
    expect(saved.blockLogs[0].output).toEqual({ content: 'answer', model: 'native/model' })
    const restored = restoreExecutionContext(JSON.parse(JSON.stringify(saved)))
    expect(restored.blockStates.get('automatic')?.output).toEqual({
      content: 'answer',
      model: 'native/model',
    })
    expect(restored.blockStates.get('structured')?.output).toEqual({
      model: 'business model',
      tokens: 9,
      cost: { business: true },
      nested: { inference: 'literal' },
    })
  })
})

describe('trusted failure checkpoint projection', () => {
  const failure = () =>
    withInferenceFacts(
      Object.assign(new Error('Authorization: Bearer synthetic-r10-key'), {
        name: 'ProviderDiagnosticError',
        model: 'native/model',
        tokens: { prompt: 11, completion: 6, total: 17 },
        cost: { status: 'unavailable' },
        toolCost: 2,
        unavailableToolCosts: 1,
        providerTiming: { private: true },
        cause: new Error('private provider diagnostics'),
        error: 'functional error',
        status: 500,
        success: false,
        toolResults: [
          { output: { model: 'business', tokens: 3, cost: 'literal', inference: 'literal' } },
        ],
      }),
      {
        model: 'native/model',
        tokens: { prompt: 11, completion: 6, total: 17 },
        cost: { status: 'unavailable' },
        generatedFields: [
          'model',
          'tokens',
          'cost',
          'toolCost',
          'unavailableToolCosts',
          'providerTiming',
          'toolResults',
        ],
      }
    )

  it('normalizes a trusted Error into safe functional data without mutating its live facts', () => {
    const error = failure()
    const facts = getInferenceFacts(error)
    const originalStack = error.stack
    const projected = checkpointFunctionalOutput({ result: error, sameError: error })
    expect(Object.getPrototypeOf(projected.result)).toBe(Object.prototype)
    expect(projected.result).toEqual({
      name: 'Error',
      message: 'Authorization: [redacted]',
      model: 'native/model',
      error: 'functional error',
      status: 500,
      success: false,
      toolResults: [
        { output: { model: 'business', tokens: 3, cost: 'literal', inference: 'literal' } },
      ],
    })
    expect(projected.sameError).toBe(projected.result)
    expect(getInferenceFacts(projected.result)).toBeUndefined()
    expect(error.stack).toBe(originalStack)
    expect(error.cause).toBeInstanceOf(Error)
    expect(error.tokens.total).toBe(17)
    expect(getInferenceFacts(error)).toBe(facts)
  })

  it('preserves unbranded Error/prototype semantics and schema-owned business fields', () => {
    const error = Object.assign(new Error('business failure'), {
      tokens: 3,
      cost: 'literal',
      cause: 'business cause',
    })
    class BusinessValue {
      cost = 'business cost'
    }
    const custom = new BusinessValue()
    const plain = {
      name: 'business name',
      message: 'business message',
      stack: 'business stack',
      cause: 'business cause',
      model: 'business model',
      tokens: 8,
      cost: 9,
    }
    const schemaOwned = withInferenceFacts(
      { ...plain },
      { tokens: { total: 17 }, generatedFields: [] }
    )
    const projected = checkpointFunctionalOutput({ error, custom, plain, schemaOwned })
    expect(projected.error).toBe(error)
    expect(projected.custom).toBe(custom)
    expect(projected.plain).toEqual(plain)
    expect(projected.schemaOwned).toEqual(plain)
    expect(getInferenceFacts(projected.schemaOwned)).toBeUndefined()
  })

  it('normalizes nested tool-run failures across log/state/current/final JSON checkpoint destinations', () => {
    const error = failure()
    const facts = getInferenceFacts(error)
    const nested = { toolResults: [{ run: { result: error } }] }
    const context: ExecutionContext = createMockContext()
    context.blockStates = new Map([
      ['failed', { output: nested, executed: true, executionTime: 1 }],
    ])
    context.blockLogs = [
      {
        id: 'checkpoint.test.ts:saved-occurrence:2',
        blockId: 'failed',
        startedAt: 'start',
        endedAt: 'end',
        durationMs: 1,
        success: false,
        output: error,
        inference: facts,
      },
    ]
    const saved = saveExecutionContext(context)
    // log.output is flattened before the outer projector; its Error message must survive that seam.
    expect(saved.blockLogs[0].output).toHaveProperty('message', 'Authorization: [redacted]')
    const checkpoint = finalizeExecutorCheckpoint({
      workflow: createMinimalWorkflow(),
      context: saved,
      currentBlockStates: { failed: nested },
      iteration: 1,
      finalOutput: { response: nested },
    })
    const cold = JSON.parse(JSON.stringify(checkpoint))
    const restored = restoreExecutionContext(cold.context)
    expect(restored.blockStates.get('failed')?.output).toEqual(cold.currentBlockStates.failed)
    const liveCopies = [
      saved.blockLogs[0].output,
      restored.blockLogs[0].output,
      cold.currentBlockStates.failed.toolResults[0].run.result,
      cold.finalOutput.response.toolResults[0].run.result,
    ]
    for (const copy of liveCopies) {
      expect(copy).toMatchObject({
        name: 'Error',
        message: 'Authorization: [redacted]',
        model: 'native/model',
        status: 500,
        success: false,
        error: 'functional error',
      })
      for (const field of [
        'tokens',
        'cost',
        'toolCost',
        'unavailableToolCosts',
        'providerTiming',
        'stack',
        'cause',
      ])
        expect(copy).not.toHaveProperty(field)
      expect(copy.toolResults[0].output).toEqual({
        model: 'business',
        tokens: 3,
        cost: 'literal',
        inference: 'literal',
      })
      expect(getInferenceFacts(copy)).toBeUndefined()
    }
    expect(JSON.stringify(cold)).not.toContain('synthetic-r10-key')
    expect(error.tokens.total).toBe(17)
    expect(getInferenceFacts(error)).toBe(facts)
  })
})

describe('original complete-read checkpoint Memory proof', () => {
  function original() {
    const message = { role: 'system' as const, content: ' exact🔥\n ' }
    const identity = workflowMemoryIdentity('workspace', 'workflow', 'source')
    return attachWorkflowMessageSource(message, {
      messageId: 'original-message',
      ...identity,
      readProof: {
        version: 1,
        workspaceId: 'workspace',
        workflowId: 'workflow',
        key: 'source',
        digest: workflowMessageDigest([message]),
      },
    })
  }
  function capture(message: { role: string; content: string }) {
    const context = createMockContext({ workspaceId: 'workspace' })
    context.blockStates.set('memory', {
      output: { memories: [message] },
      executed: true,
      executionTime: 1,
    })
    return finalizeExecutorCheckpoint({
      workflow: createMinimalWorkflow(),
      context: saveExecutionContext(context),
      currentBlockStates: { memory: { memories: [message] } },
      iteration: 1,
      finalOutput: {},
    })
  }
  it('persists distinct v2 original proof without changing plain message bytes', () => {
    const message = original()
    const checkpoint = capture(message)
    expect(checkpoint.workflowMemorySources?.version).toBe(2)
    expect(checkpoint.workflowMemorySources?.entries.length).toBeGreaterThan(0)
    for (const entry of checkpoint.workflowMemorySources!.entries)
      expect(entry.digest).toBe(getWorkflowMessageSource(message)?.readProof?.digest)
    const cold = JSON.parse(JSON.stringify(checkpoint))
    expect(cold.currentBlockStates.memory.memories[0]).toEqual({
      role: 'system',
      content: ' exact🔥\n ',
    })
    expect(getWorkflowMessageSource(cold.currentBlockStates.memory.memories[0])).toBeUndefined()
  })
  it.each(['role', 'content'] as const)(
    'rejects post-read %s mutation and a private-brand copy instead of blessing a new hash',
    (field) => {
      const message = original()
      if (field === 'content') message.content = 'post-read mutation'
      else Object.assign(message, { role: 'user' })
      expect(() => capture(message)).toThrow(/original|changed/i)
      const copied = copyWorkflowMessageSource(message, { ...message })
      expect(() => capture(copied)).toThrow(/original|changed/i)
    }
  )
  it('never promotes ordinary JSON/inherited fields and refuses correlation-only or foreign owner proof', () => {
    const message = original()
    expect(capture(JSON.parse(JSON.stringify(message))).workflowMemorySources).toBeUndefined()
    expect(capture(Object.create(message)).workflowMemorySources).toBeUndefined()
    const identity = workflowMemoryIdentity('workspace', 'workflow', 'source')
    expect(() =>
      capture(
        attachWorkflowMessageSource(
          { role: 'user', content: 'ordinary' },
          { messageId: 'correlation', ...identity }
        )
      )
    ).toThrow(/proof/)
    expect(() =>
      capture(
        attachWorkflowMessageSource(
          { role: 'system', content: ' exact🔥\n ' },
          {
            messageId: 'foreign',
            ...identity,
            readProof: {
              version: 1,
              workspaceId: 'different',
              workflowId: 'workflow',
              key: 'source',
              digest: workflowMessageDigest([message]),
            },
          }
        )
      )
    ).toThrow(/scope/)
  })
})

it('preserves saved IDs through cold checkpoint JSON and refuses missing, malformed or duplicate occurrences', () => {
  const workflow = createMinimalWorkflow()
  const context: ExecutionContext = createMockContext({
    workflow,
    workspaceId: 'workspace',
    workflowId: 'workflow',
  })
  context.blockLogs = [
    {
      id: 'saved-first',
      blockId: 'same-block',
      blockType: 'variables',
      startedAt: '2026-11-10T00:00:00Z',
      endedAt: '2026-11-10T00:00:00Z',
      durationMs: 0,
      success: true,
      output: { value: 0 },
    },
    {
      id: 'saved-second',
      blockId: 'same-block',
      blockType: 'variables',
      startedAt: '2026-11-10T00:00:00Z',
      endedAt: '2026-11-10T00:00:00Z',
      durationMs: 0,
      success: true,
      output: { value: 1 },
    },
  ]
  const snapshot = {
    workflow,
    currentBlockStates: {},
    context: saveExecutionContext(context),
    iteration: 1,
    finalOutput: {},
  }
  const cold = JSON.parse(JSON.stringify(finalizeExecutorCheckpoint(snapshot)))
  expect(restoreExecutionContext(cold.context).blockLogs).toEqual(context.blockLogs)
  for (const id of [undefined, null, '', '   ', 3, {}]) {
    const invalid = structuredClone(cold)
    Reflect.set(invalid.context.blockLogs[0], 'id', id)
    expect(() => restoreExecutionContext(invalid.context)).toThrow('block occurrence')
    expect(() => finalizeExecutorCheckpoint(invalid)).toThrow('block occurrence')
    Reflect.set(context.blockLogs[0], 'id', id)
    expect(() => saveExecutionContext(context)).toThrow('block occurrence')
    context.blockLogs[0].id = 'saved-first'
  }
  const duplicate = structuredClone(cold)
  duplicate.context.blockLogs[1].id = duplicate.context.blockLogs[0].id
  expect(() => restoreExecutionContext(duplicate.context)).toThrow('block occurrence')
  expect(() => finalizeExecutorCheckpoint(duplicate)).toThrow('block occurrence')
  context.blockLogs[1].id = context.blockLogs[0].id
  expect(() => saveExecutionContext(context)).toThrow('block occurrence')
})

it('refuses occurrence envelopes whose identities are not owned serializable data records', () => {
  const workflow = createMinimalWorkflow()
  const context: ExecutionContext = createMockContext({
    workflow,
    workspaceId: 'workspace',
    workflowId: 'workflow',
  })
  const log = {
    id: 'original saved id',
    blockId: 'block',
    blockType: 'variables',
    startedAt: '2026-11-10',
    endedAt: '2026-11-10',
    durationMs: 0,
    success: true,
    output: { value: 1 },
  }
  context.blockLogs = [log]
  const saved = saveExecutionContext(context)
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
    const invalidContext = structuredClone(saved)
    Reflect.set(invalidContext, 'blockLogs', [make(log)])
    expect(() => restoreExecutionContext(invalidContext), name).toThrow('block occurrence')
    expect(
      () =>
        finalizeExecutorCheckpoint({
          workflow,
          context: invalidContext,
          currentBlockStates: {},
          iteration: 1,
          finalOutput: {},
        }),
      name
    ).toThrow('block occurrence')
    Reflect.set(context, 'blockLogs', [make(log)])
    expect(() => saveExecutionContext(context), name).toThrow('block occurrence')
  }
})
it('keeps plain and null-prototype occurrence raw IDs and nested toJSON-named business data exact', () => {
  const workflow = createMinimalWorkflow()
  const context: ExecutionContext = createMockContext({
    workflow,
    workspaceId: 'workspace',
    workflowId: 'workflow',
  })
  const output = {
    toJSON: 'schema-owned',
    nested: { toJSON: { literal: true }, id: 'business id' },
  }
  for (const prototype of [Object.prototype, null]) {
    const id = '  exact opaque saved id🔥  '
    const log = Object.assign(Object.create(prototype), {
      id,
      blockId: 'block',
      blockType: 'variables',
      startedAt: '2026-11-10',
      endedAt: '2026-11-10',
      durationMs: 0,
      success: true,
      output,
    })
    context.blockLogs = [log]
    const saved = saveExecutionContext(context)
    const final = finalizeExecutorCheckpoint({
      workflow,
      context: saved,
      currentBlockStates: {},
      iteration: 1,
      finalOutput: {},
    })
    const restored = restoreExecutionContext(JSON.parse(JSON.stringify(final.context)))
    expect(restored.blockLogs[0].id).toBe(id)
    expect(restored.blockLogs[0].output).toEqual(output)
  }
})

// R12 docs accounting exclusion hunk; root merges alongside occurrence controls.
describe('owned documentation embedding facts at checkpoint persistence', () => {
  it('removes only producer-generated embeddingUsage on a copy and through the actual writer/reader', () => {
    const liveUsage = {
      model: 'openai/text-embedding-3-small',
      tokens: { prompt: 12, total: 12 },
      usage: { status: 'reported', batches: 1 },
      cost: { status: 'unavailable' },
    }
    const live = withInferenceFacts(
      {
        results: [{ content: 'exact functional docs' }],
        embeddingUsage: liveUsage,
        business: { embeddingUsage: 'literal business value' },
      },
      {
        model: 'openai/text-embedding-3-small',
        tokens: { prompt: 12, total: 12 },
        cost: { status: 'unavailable' },
        embeddingUsage: { status: 'reported', batches: 1 },
        generatedFields: ['model', 'tokens', 'cost', 'embeddingUsage'],
      }
    )
    const business = {
      embeddingUsage: { tokens: 'business tokens', status: 'business' },
      tokens: 'literal tokens',
      cost: 'literal cost',
    }
    const schemaOwned = withInferenceFacts(
      { ...business },
      {
        embeddingUsage: { status: 'reported', batches: 1 },
        generatedFields: [],
      }
    )
    const projected = checkpointFunctionalOutput({ live, business, schemaOwned })
    expect(projected.live).toEqual({ results: live.results, business: live.business })
    expect(projected.business).toEqual(business)
    expect(projected.schemaOwned).toEqual(business)
    expect(getInferenceFacts(projected.live)).toBeUndefined()
    expect(live.embeddingUsage).toBe(liveUsage)
    expect(getInferenceFacts(live)?.embeddingUsage).toEqual({ status: 'reported', batches: 1 })
    const context = createMockContext()
    context.blockStates = new Map([
      ['docs', { output: live, executed: true, executionTime: 1 }],
      ['schema', { output: schemaOwned, executed: true, executionTime: 1 }],
    ])
    const restored = restoreExecutionContext(
      JSON.parse(JSON.stringify(saveExecutionContext(context)))
    )
    expect(restored.blockStates.get('docs')?.output).toEqual({
      results: live.results,
      business: live.business,
    })
    expect(restored.blockStates.get('schema')?.output).toEqual(business)
    expect(live.embeddingUsage).toBe(liveUsage)
  })
})
