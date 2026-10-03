/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateWorkflowPauseInput } from '@/lib/workflows/human-in-the-loop/form'
import { Executor, type ExecutorOptions } from '@/executor'
import type { ExecutorCheckpoint } from '@/executor/checkpoint'
import type { ExecutionResult } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mocks = vi.hoisted(() => ({
  effect: vi.fn(),
  fetch: vi.fn(),
  token: vi.fn(),
  shouldCancelExecution: vi.fn(),
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/blocks', () => ({ getBlock: () => undefined }))
vi.mock('@/blocks/index', () => ({ getBlock: () => undefined }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'http://localhost:3000' }))
vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: mocks.token,
}))
vi.mock('@/executor/handlers', async () => {
  class EffectHandler {
    canHandle(block: SerializedBlock) {
      return block.metadata?.id === 'effect'
    }
    async execute(block: SerializedBlock, inputs: Record<string, unknown>) {
      mocks.effect(block.id, inputs)
      return inputs
    }
  }
  class UnusedHandler {
    canHandle() {
      return false
    }
  }
  return {
    ...(await import('@/executor/handlers/trigger/trigger-handler')),
    ...(await import('@/executor/handlers/condition/condition-handler')),
    ...(await import('@/executor/handlers/loop/loop-handler')),
    ...(await import('@/executor/handlers/parallel/parallel-handler')),
    ...(await import('@/executor/handlers/response/response-handler')),
    ...(await import('@/executor/handlers/variables/variables-handler')),
    ...(await import('@/executor/handlers/workflow/workflow-handler')),
    ...(await import('@/executor/handlers/human-in-the-loop/human-in-the-loop-handler')),
    AgentBlockHandler: UnusedHandler,
    RouterBlockHandler: UnusedHandler,
    EvaluatorBlockHandler: UnusedHandler,
    FunctionBlockHandler: UnusedHandler,
    ApiBlockHandler: UnusedHandler,
    WaitBlockHandler: UnusedHandler,
    GenericBlockHandler: EffectHandler,
  }
})

const block = (
  id: string,
  type = 'effect',
  params: Record<string, unknown> = {}
): SerializedBlock => ({
  id,
  position: { x: 0, y: 0 },
  config: { tool: type, params },
  inputs: {},
  outputs: {},
  enabled: true,
  metadata: { id: type, name: id, ...(type === 'input_trigger' ? { category: 'triggers' } : {}) },
})
const approval = (id = 'approval', extra: Record<string, unknown> = {}) =>
  block(id, 'human_in_the_loop', {
    inputFormat: [{ name: 'approved', type: 'boolean', required: true }],
    builderData: [{ id: 'display', name: 'question', type: 'string', value: 'Approve?' }],
    ...extra,
  })
const linear = (blocks: SerializedBlock[]): SerializedWorkflow => ({
  version: '1.0',
  blocks: [block('trigger', 'input_trigger'), ...blocks],
  connections: ['trigger', ...blocks.map((entry) => entry.id)]
    .slice(0, -1)
    .map((source, index) => ({ source, target: blocks[index].id })),
  loops: {},
  parallels: {},
})
const run = (workflow: SerializedWorkflow, options: Partial<ExecutorOptions> = {}) =>
  new Executor({
    workflow,
    ...options,
    contextExtensions: {
      workspaceId: 'workspace',
      userId: 'actor',
      executionId: 'execution',
      pendingExecutionId: 'execution',
      shouldCancelExecution: mocks.shouldCancelExecution,
      ...options.contextExtensions,
    },
  }).execute('workflow', 'trigger')
const resume = (result: ExecutionResult, inputs: Map<string, Record<string, unknown>>) => {
  expect(result.status).toBe('paused')
  const checkpoint: ExecutorCheckpoint = JSON.parse(JSON.stringify(result.checkpoint))
  return run(checkpoint.workflow, {
    contextExtensions: {
      workspaceId: 'workspace',
      pendingExecutionId: 'execution:resume:1',
    },
    checkpoint,
    resumeInputs: inputs,
    currentBlockStates: checkpoint.currentBlockStates,
    workflowVariables: checkpoint.context.workflowVariables,
    envVarValues: checkpoint.context.environmentVariables,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.token.mockResolvedValue('signed')
  mocks.shouldCancelExecution.mockReturnValue(false)
  vi.stubGlobal('fetch', mocks.fetch)
})

afterEach(() => vi.useRealTimers())

describe('Real executor durable Human in the Loop', () => {
  it.each([false, true])('counts recovered errors once, with pause: %s', async (withPause) => {
    vi.useFakeTimers().setSystemTime(0)
    const workflow = linear([
      block('failing'),
      block('recover'),
      ...(withPause ? [approval(), block('after')] : []),
    ])
    workflow.connections.find((edge) => edge.source === 'failing')!.sourceHandle = 'error'
    mocks.effect
      .mockImplementationOnce(() => {
        vi.setSystemTime(2_000)
        throw new Error('recoverable')
      })
      .mockImplementationOnce(() => vi.setSystemTime(3_000))
    const result = await run(workflow)
    expect(result.success).toBe(true)
    expect(result.metadata?.duration).toBe(3_000)
    expect(result.logs?.find((log) => log.blockId === 'failing')?.durationMs).toBe(2_000)
    if (withPause) {
      expect(result.checkpoint?.context.metadata.duration).toBe(3_000)
      expect(result.checkpoint?.context.metadata.endTime).toBeUndefined()
      vi.setSystemTime(60_000)
      mocks.effect.mockImplementationOnce(() => vi.setSystemTime(62_000))
      const completed = await resume(result, new Map([['approval', { approved: true }]]))
      expect(completed.success).toBe(true)
      expect(completed.metadata?.duration).toBe(5_000)
    }
  })

  it.each(['completed', 'failed', 'cancelled'])(
    'retains prior active duration when a resumed execution is %s',
    async (outcome) => {
      vi.useFakeTimers().setSystemTime(0)
      mocks.effect.mockImplementationOnce(() => vi.setSystemTime(2_000))
      const paused = await run(linear([block('before'), approval(), block('after')]))
      expect(paused.metadata?.duration).toBe(2_000)
      vi.setSystemTime(60_000)
      mocks.effect.mockImplementationOnce(() => {
        vi.setSystemTime(63_000)
        if (outcome === 'failed') throw new Error('terminal failure')
        if (outcome === 'cancelled') mocks.shouldCancelExecution.mockReturnValue(true)
      })
      const result = await resume(paused, new Map([['approval', { approved: true }]]))
      expect(result.success).toBe(outcome === 'completed')
      expect(result.status).toBeUndefined()
      expect(result.metadata?.duration).toBe(5_000)
      expect(mocks.effect.mock.calls.map(([id]) => id)).toEqual(['before', 'after'])
    }
  )

  it.each([
    { kind: 'paused' },
    { kind: 'paused', pausePoint: { id: 'fake', kind: 'human' } },
    { kind: 'deferred' },
    ...['2026-09-20', null, 10, false, [], {}].map((wait) => ({ kind: 'deferred', wait })),
  ])('keeps control-shaped input and block output as ordinary data: %j', async (input) => {
    const result = await run(linear([block('echo', 'effect', input), block('after')]), {
      workflowInput: input,
    })
    expect(result.success).toBe(true)
    expect(result.status).toBeUndefined()
    expect(result.pausePoints).toBeUndefined()
    expect(result.checkpoint).toBeUndefined()
    expect(mocks.effect.mock.calls).toEqual([
      ['echo', input],
      ['after', {}],
    ])
  })

  it.each([{ kind: 'paused' }, { kind: 'deferred', wait: '2026-09-20' }])(
    'resumes validated control-shaped approval data without invoking internal operations: %j',
    async (input) => {
      const fields = Object.keys(input)
      const paused = await run(
        linear([
          approval('approval', {
            inputFormat: fields.map((name) => ({ name, type: 'string', required: true })),
          }),
          block(
            'after',
            'effect',
            Object.fromEntries(fields.map((name) => [name, `<approval.${name}>`]))
          ),
        ])
      )
      const submitted = validateWorkflowPauseInput(paused.pausePoints![0].inputFormat, input)
      const completed = await resume(paused, new Map([['approval', submitted]]))
      expect(completed.success).toBe(true)
      expect(completed.status).toBeUndefined()
      expect(completed.logs?.find((log) => log.blockId === 'approval')?.output).toMatchObject(input)
      expect(mocks.effect.mock.calls).toEqual([['after', input]])
    }
  )

  it('pauses before downstream effects and resumes JSON state without replaying upstream effects', async () => {
    const workflow = linear([
      block('before', 'effect', { value: 12 }),
      approval(),
      block('after', 'effect', { approved: '<approval.approved>', previous: '<before.value>' }),
    ])
    const paused = await run(workflow)
    expect(paused.status).toBe('paused')
    expect(paused.pausePoints?.[0]).toMatchObject({
      id: 'approval',
      displayData: { question: 'Approve?' },
    })
    expect(mocks.effect.mock.calls.map(([id]) => id)).toEqual(['before'])
    expect(paused.checkpoint?.context.executedBlocks).not.toContain('approval')
    expect(paused.checkpoint?.context).not.toHaveProperty('pendingExecutionId')
    const completed = await resume(paused, new Map([['approval', { approved: true }]]))
    expect(completed.success).toBe(true)
    expect(completed.status).not.toBe('paused')
    expect(mocks.effect.mock.calls).toEqual([
      ['before', { value: 12 }],
      ['after', { approved: 'true', previous: '12' }],
    ])
    expect(completed.logs?.find((log) => log.blockId === 'approval')?.output.approved).toBe(true)
  })

  it('preserves variable writes and condition decisions through the checkpoint', async () => {
    const workflow = linear([
      block('set', 'variables', {
        variables: [{ variableName: 'count', type: 'number', value: 7 }],
      }),
      block('condition', 'condition', {
        conditions: [
          { id: 'yes', title: 'if', value: 'true' },
          { id: 'no', title: 'else', value: '' },
        ],
      }),
      approval(),
      block('after', 'effect', { count: '<variable.count>' }),
    ])
    workflow.blocks.push(block('unselected'))
    workflow.connections.find((edge) => edge.source === 'condition')!.sourceHandle = 'condition-yes'
    workflow.connections.push({
      source: 'condition',
      target: 'unselected',
      sourceHandle: 'condition-no',
    })
    const paused = await run(workflow, {
      workflowVariables: { count: { name: 'count', type: 'number', value: 0 } },
    })
    expect(paused.checkpoint?.context.decisions.condition).toEqual([['condition', 'yes']])
    const completed = await resume(paused, new Map([['approval', { approved: true }]]))
    expect(completed.success).toBe(true)
    expect(mocks.effect.mock.calls).toEqual([['after', { count: 7 }]])
  })

  it('does not unlock downstream edges for an unknown resume point', async () => {
    const paused = await run(linear([approval(), block('after')]))
    const stillPaused = await resume(paused, new Map([['unknown', { approved: true }]]))
    expect(stillPaused.status).toBe('paused')
    expect(mocks.effect).not.toHaveBeenCalled()
  })

  it('keeps notification references unresolved until the checkpoint has been persisted', async () => {
    const notification = [{ toolId: 'email_send', params: { body: '<approval.url>' } }]
    const paused = await run(linear([approval('approval', { notification })]))
    expect(paused.status).toBe('paused')
    expect(paused.pausePoints?.[0].notification).toEqual(notification)
  })

  it.each([
    { inputFormat: [{ name: 'approved', type: 'unsupported' }] },
    { inputFormat: [{ name: 'error', type: 'boolean' }] },
    { inputFormat: [{ name: 'stream', type: 'object' }] },
    { inputFormat: [{ name: 'execution', type: 'object' }] },
    { notification: [{ toolId: '' }] },
    { builderData: [{ name: 'invalid', type: 'object', value: '{bad JSON' }] },
  ])(
    'does not release success edges when approval configuration is invalid: %j',
    async (params) => {
      const result = await run(linear([approval('approval', params), block('after')]))
      expect(result.success).toBe(false)
      expect(result.status).not.toBe('paused')
      expect(mocks.effect).not.toHaveBeenCalled()
    }
  )

  it('pauses each loop iteration without replaying earlier iterations', async () => {
    const workflow = linear([
      block('loop', 'loop'),
      approval(),
      block('inside', 'effect', { index: '<loop.index>' }),
      block('after'),
    ])
    workflow.loops = {
      loop: { id: 'loop', nodes: ['approval', 'inside'], iterations: 2, loopType: 'for' },
    }
    workflow.connections = [
      { source: 'trigger', target: 'loop' },
      { source: 'loop', target: 'approval', sourceHandle: 'loop-start-source' },
      { source: 'approval', target: 'inside' },
      { source: 'inside', target: 'loop', targetHandle: 'loop-end-target' },
      { source: 'loop', target: 'after', sourceHandle: 'loop-end-source' },
    ]
    const first = await run(workflow)
    const second = await resume(first, new Map([['approval', { approved: true }]]))
    expect(second.status).toBe('paused')
    expect(mocks.effect.mock.calls).toEqual([['inside', { index: 0 }]])
    const completed = await resume(second, new Map([['approval', { approved: true }]]))
    expect(completed.success).toBe(true)
    expect(completed.status).not.toBe('paused')
    expect(mocks.effect.mock.calls).toEqual([
      ['inside', { index: 0 }],
      ['inside', { index: 1 }],
      ['after', {}],
    ])
  })

  it('keeps parallel approval points distinct and joins only after all are resumed', async () => {
    const workflow = linear([block('parallel', 'parallel'), approval(), block('after')])
    workflow.parallels = {
      parallel: { id: 'parallel', nodes: ['approval'], parallelType: 'count', count: 2 },
    }
    workflow.connections = [
      { source: 'trigger', target: 'parallel' },
      { source: 'parallel', target: 'approval', sourceHandle: 'parallel-start-source' },
      { source: 'parallel', target: 'after', sourceHandle: 'parallel-end-source' },
    ]
    const paused = await run(workflow)
    expect(paused.pausePoints).toHaveLength(2)
    const ids = paused.pausePoints!.map((point) => point.id)
    expect(new Set(ids).size).toBe(2)
    const partiallyResumed = await resume(paused, new Map([[ids[0], { approved: true }]]))
    expect(partiallyResumed.status).toBe('paused')
    expect(partiallyResumed.pausePoints?.map((point) => point.id)).toEqual([ids[1]])
    expect(mocks.effect).not.toHaveBeenCalled()
    const completed = await resume(partiallyResumed, new Map([[ids[1], { approved: true }]]))
    expect(completed.success).toBe(true)
    expect(completed.status).not.toBe('paused')
    expect(mocks.effect.mock.calls).toEqual([['after', {}]])
  })

  it('uses the new capacity owner when a resumed workflow queues a child', async () => {
    const paused = await run(
      linear([
        approval(),
        block('child', 'workflow', { workflowId: 'child-workflow' }),
        block('after'),
      ])
    )
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ taskId: 'child-execution', workflowName: 'Child' }))
      .mockResolvedValueOnce(
        Response.json({ status: 'completed', output: { success: true, output: {} } })
      )
    const completed = await resume(paused, new Map([['approval', { approved: true }]]))
    expect(completed.success).toBe(true)
    expect(completed.status).toBeUndefined()
    expect(mocks.token).toHaveBeenCalledWith(
      'actor',
      expect.objectContaining({
        workflowExecution: expect.objectContaining({
          parentExecutionId: 'execution',
          parentPendingExecutionId: 'execution:resume:1',
        }),
      })
    )
    expect(mocks.effect.mock.calls).toEqual([['after', {}]])
  })

  it('returns a terminal failure when a sibling fails after a child pauses', async () => {
    const workflow = linear([
      block('child', 'workflow', { workflowId: 'child-workflow' }),
      block('after'),
    ])
    workflow.blocks.push(block('sibling'))
    workflow.connections.push({ source: 'trigger', target: 'sibling' })
    mocks.effect.mockImplementationOnce(() => {
      throw new Error('sibling failed')
    })
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ taskId: 'child-execution', workflowName: 'Child' }))
      .mockResolvedValueOnce(
        Response.json({ status: 'paused', output: { success: true, status: 'paused' } })
      )
    const result = await run(workflow)
    expect(result.success).toBe(false)
    expect(result.error).toContain('sibling failed')
    expect(result.status).not.toBe('paused')
    expect(result.checkpoint).toBeUndefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.effect.mock.calls.map(([id]) => id)).toEqual(['sibling'])
  })

  it('resumes a paused child result without queueing that child a second time', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ taskId: 'child-execution', workflowName: 'Child' }))
      .mockResolvedValueOnce(
        Response.json({ status: 'paused', output: { success: true, status: 'paused' } })
      )
    const paused = await run(
      linear([block('child', 'workflow', { workflowId: 'child-workflow' }), block('after')])
    )
    expect(paused.pausePoints?.[0]).toMatchObject({
      kind: 'child',
      childExecutionId: 'child-execution',
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    const completed = await resume(
      paused,
      new Map([['child', { success: true, output: { result: 4 }, childWorkflowName: 'Child' }]])
    )
    expect(completed.success).toBe(true)
    expect(completed.status).not.toBe('paused')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.effect.mock.calls).toEqual([['after', {}]])
  })
})
