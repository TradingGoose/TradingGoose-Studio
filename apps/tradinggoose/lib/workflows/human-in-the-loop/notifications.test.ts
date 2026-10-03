/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlackBlock } from '@/blocks/blocks/slack'
import { createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { type ExecutorCheckpoint, saveExecutionContext } from '@/executor/checkpoint'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { slackMessageTool } from '@/tools/slack/message'
import { dispatchWorkflowPauseNotifications } from './notifications'
import type { WorkflowPausePoint } from './types'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getBlock: vi.fn(), error: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: mocks.execute }))
vi.mock('@/blocks', () => ({ getBlock: mocks.getBlock }))
vi.mock('@/blocks/index', () => ({ getBlock: mocks.getBlock }))
vi.mock('@/components/icons/icons', () => ({ SlackIcon: () => null }))
vi.mock('@/triggers', () => ({ getTrigger: () => undefined }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://studio.example' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: mocks.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

const block = (id: string, type: string): SerializedBlock => ({
  id,
  position: { x: 0, y: 0 },
  config: { tool: type, params: {} },
  inputs: {},
  outputs: {},
  enabled: true,
  metadata: { id: type, name: id },
})
const point = (params: Record<string, unknown>, id = 'approval'): WorkflowPausePoint => ({
  id,
  blockId: 'approval',
  blockName: 'Approval',
  kind: 'human',
  displayData: {},
  inputFormat: [],
  notification: [{ toolId: 'notify', params }],
})
const fixture = () => {
  const workflow: SerializedWorkflow = {
    version: '1.0',
    blocks: [block('upstream', 'function'), block('approval', 'human_in_the_loop')],
    connections: [{ source: 'upstream', target: 'approval' }],
    loops: {},
    parallels: {},
  }
  const context: ExecutionContext = {
    ...createMockContext({ workflow }),
    workflowId: 'workflow',
    workspaceId: 'workspace',
    executionId: 'execution',
    userId: 'actor',
    environmentVariables: { TOKEN: 'secret' },
    workflowVariables: { reviewer: { name: 'reviewer', type: 'plain', value: 'member' } },
    blockStates: new Map([
      ['upstream', { output: { customer: 'Ada' }, executed: true, executionTime: 1 }],
    ]),
  }
  const snapshot = (): ExecutorCheckpoint =>
    JSON.parse(
      JSON.stringify({
        workflow,
        context: saveExecutionContext(context),
        currentBlockStates: {},
        iteration: 2,
        finalOutput: {},
      })
    )
  return { workflow, context, snapshot }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getBlock.mockImplementation((type) => (type === 'slack' ? SlackBlock : undefined))
  mocks.execute.mockResolvedValue({ success: true, output: {} })
})

describe('Durable approval notifications', () => {
  it('resolves the review URL, upstream data, variables and secrets with the original actor scope', async () => {
    const { snapshot } = fixture()
    await dispatchWorkflowPauseNotifications(snapshot(), [
      point({
        message: 'Review <upstream.customer> at <approval.url>',
        endpoint: '<approval.resumeEndpoint>',
        reviewer: '<variable.reviewer>',
        token: '{{TOKEN}}',
      }),
    ])
    expect(mocks.execute).toHaveBeenCalledWith(
      'notify',
      {
        message: 'Review Ada at https://studio.example/resume/workflow/execution',
        endpoint: 'https://studio.example/api/resume/workflow/execution',
        reviewer: 'member',
        token: 'secret',
      },
      false,
      expect.objectContaining({
        userId: 'actor',
        workspaceId: 'workspace',
        workflowId: 'workflow',
        executionId: 'execution',
      })
    )
  })

  it('preserves canonical Slack tool parameters instead of reapplying incompatible block transforms', async () => {
    const { snapshot } = fixture()
    const approval = point({})
    approval.notification = [
      {
        toolId: 'slack_message',
        params: {
          destinationType: 'dm',
          dmUserId: 'reviewer',
          credential: 'credential',
          text: 'Review <approval.url>',
          thread_ts: '123.456',
        },
      },
    ]
    await dispatchWorkflowPauseNotifications(snapshot(), [approval])
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const body = slackMessageTool.request.body!(mocks.execute.mock.calls[0][1])
    expect(body).toMatchObject({
      credentialId: 'credential',
      userId: 'reviewer',
      text: 'Review https://studio.example/resume/workflow/execution',
      thread_ts: '123.456',
    })
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('resolves distinct upstream states and collection items for parallel approval points', async () => {
    const { workflow, context, snapshot } = fixture()
    workflow.blocks.unshift(block('parallel', 'parallel'))
    workflow.connections.unshift({
      source: 'parallel',
      target: 'upstream',
      sourceHandle: 'parallel-start-source',
    })
    workflow.parallels = {
      parallel: {
        id: 'parallel',
        nodes: ['upstream', 'approval'],
        parallelType: 'collection',
        distribution: ['first', 'second'],
      },
    }
    context.parallelBlockMapping = new Map()
    for (let index = 0; index < 2; index++) {
      for (const id of ['upstream', 'approval'])
        context.parallelBlockMapping.set(`${id}_parallel_parallel_iteration_${index}`, {
          originalBlockId: id,
          parallelId: 'parallel',
          iterationIndex: index,
        })
      context.blockStates.set(`upstream_parallel_parallel_iteration_${index}`, {
        output: { customer: `customer-${index}` },
        executed: true,
        executionTime: 1,
      })
      context.loopItems.set(`parallel_iteration_${index}`, index === 0 ? 'first' : 'second')
    }
    const points = [0, 1].map((index) =>
      point(
        {
          message:
            '<parallel.index>: <parallel.currentItem> / <upstream.customer> / <approval.url>',
        },
        `approval_parallel_parallel_iteration_${index}`
      )
    )
    await dispatchWorkflowPauseNotifications(snapshot(), points)
    expect(mocks.execute.mock.calls.map((call) => call[1].message)).toEqual([
      '0: first / customer-0 / https://studio.example/resume/workflow/execution',
      '1: second / customer-1 / https://studio.example/resume/workflow/execution',
    ])
  })

  it('retains the enclosing loop item and iteration from the saved checkpoint', async () => {
    const { workflow, context, snapshot } = fixture()
    workflow.blocks.unshift(block('loop', 'loop'))
    workflow.loops = {
      loop: {
        id: 'loop',
        nodes: ['approval'],
        iterations: 2,
        loopType: 'forEach',
        forEachItems: ['first', 'second'],
      },
    }
    context.loopIterations.set('loop', 2)
    context.loopItems.set('loop', 'second')
    await dispatchWorkflowPauseNotifications(snapshot(), [
      point({ message: '<loop.index>: <loop.currentItem>' }),
    ])
    expect(mocks.execute.mock.calls[0][1]).toEqual({ message: '1: second' })
  })

  it('isolates failed notifications without changing the checkpoint or skipping later notifications', async () => {
    const { snapshot } = fixture()
    const checkpoint = snapshot()
    const before = JSON.stringify(checkpoint)
    const approval = point({})
    approval.notification = [{ toolId: 'rejected' }, { toolId: 'throws' }, { toolId: 'succeeds' }]
    mocks.execute
      .mockResolvedValueOnce({ success: false, error: 'denied' })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ success: true })
    await expect(
      dispatchWorkflowPauseNotifications(checkpoint, [approval])
    ).resolves.toBeUndefined()
    expect(mocks.execute.mock.calls.map((call) => call[0])).toEqual([
      'rejected',
      'throws',
      'succeeds',
    ])
    expect(mocks.error).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(checkpoint)).toBe(before)
  })
})
