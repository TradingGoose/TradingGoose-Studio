import { InMemoryStore } from '@mastra/core/storage'
import { beforeEach, expect, it, vi } from 'vitest'
import type { TraceSpan } from '@/lib/logs/types'
import { attachAgentHistory, deleteAgentHistory } from './agent-history'
import * as runtime from './runtime'

const fixture = vi.hoisted(() => ({ access: vi.fn(), thread: vi.fn(), messages: vi.fn() }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: fixture.access }))
const history = {
  threadId: 'workflow-agent:run',
  resourceId: 'workflow-execution:workspace:execution',
  runId: 'run',
}
const log = () => ({
  id: 'log',
  workspaceId: 'workspace',
  workflowId: 'workflow',
  executionId: 'execution',
  executionData: {
    traceSpans: [
      { id: 'block', blockId: 'block', inference: { history }, input: {}, children: [] },
    ],
  },
})
beforeEach(async () => {
  vi.clearAllMocks()
  const store = (await new InMemoryStore().getStore('memory'))!
  vi.spyOn(store, 'getThreadById').mockImplementation(fixture.thread)
  vi.spyOn(store, 'listMessages').mockImplementation(fixture.messages)
  vi.spyOn(runtime, 'getNativeMemoryStore').mockResolvedValue(store)
  fixture.access.mockReset().mockResolvedValue({ hasAccess: true })
  fixture.thread.mockReset().mockResolvedValue({
    id: history.threadId,
    resourceId: history.resourceId,
    metadata: {
      purpose: 'workflow-agent',
      workspaceId: 'workspace',
      executionId: 'execution',
      workflowId: 'workflow',
      logId: 'log',
      blockId: 'block',
      runId: 'run',
      systemMessages: [{ role: 'system', content: 'Policy' }],
    },
  })
  fixture.messages.mockReset().mockResolvedValue({
    messages: [
      {
        id: 'message',
        threadId: history.threadId,
        resourceId: history.resourceId,
        role: 'assistant',
        createdAt: new Date(0),
        content: { format: 2, parts: [{ type: 'text', text: 'Exact reply' }] },
      },
    ],
    hasMore: false,
  })
})
it('returns the official persisted messages and selected instructions for authorized details', async () => {
  const result = await attachAgentHistory(log(), 'actor')
  expect(result.executionData.traceSpans[0]).toMatchObject({
    agentHistory: [{ id: 'message', parts: [{ type: 'text', text: 'Exact reply' }] }],
    input: { systemMessages: [{ role: 'system', content: 'Policy' }] },
  })
  expect(fixture.access).toHaveBeenCalledTimes(2)
})
it('rejects cross-execution native references before reading any messages', async () => {
  const row = log()
  row.executionId = 'foreign'
  await expect(attachAgentHistory(row, 'actor')).rejects.toThrow('outside the authorized execution')
  expect(fixture.messages).not.toHaveBeenCalled()
})
it('rejects a mismatched native thread owner before returning its messages', async () => {
  fixture.thread.mockResolvedValueOnce({
    resourceId: history.resourceId,
    metadata: { workspaceId: 'foreign' },
  })
  await expect(attachAgentHistory(log(), 'actor')).rejects.toThrow('owner')
  expect(fixture.messages).not.toHaveBeenCalled()
})
it('rejects a thread with the expected ID but a foreign resource', async () => {
  const store = await runtime.getNativeMemoryStore()
  vi.mocked(store.getThreadById).mockRestore()
  await store.saveThread({
    thread: {
      id: history.threadId,
      resourceId: 'workflow-execution:foreign:execution',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  })

  await expect(attachAgentHistory(log(), 'actor')).rejects.toThrow('owner')
  expect(fixture.messages).not.toHaveBeenCalled()
})
it('keeps retained logs readable after partial native cleanup and hydrates surviving children', async () => {
  const store = await runtime.getNativeMemoryStore()
  vi.mocked(store.getThreadById).mockRestore()
  vi.mocked(store.listMessages).mockRestore()
  const childHistory = { ...history, runId: 'child', threadId: 'workflow-agent:child' }
  const parentSpan: TraceSpan = {
    ...log().executionData.traceSpans[0],
    name: 'Agent',
    type: 'agent',
    duration: 0,
    startTime: new Date(0).toISOString(),
    endTime: new Date(0).toISOString(),
    inference: { history, generatedFields: [] },
  }
  const row = {
    ...log(),
    executionData: {
      traceSpans: [
        {
          ...parentSpan,
          children: [
            {
              ...parentSpan,
              id: 'child',
              blockId: 'child',
              inference: { history: childHistory, generatedFields: [] },
              input: {},
              children: [],
            },
          ],
        },
      ],
    },
  }
  for (const [scope, blockId] of [
    [history, 'block'],
    [childHistory, 'child'],
  ] as const) {
    await store.saveThread({
      thread: {
        id: scope.threadId,
        resourceId: scope.resourceId,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        metadata: {
          purpose: 'workflow-agent',
          workspaceId: row.workspaceId,
          executionId: row.executionId,
          workflowId: row.workflowId,
          logId: row.id,
          blockId,
          runId: scope.runId,
        },
      },
    })
    await store.saveMessages({
      messages: [
        {
          id: `message-${blockId}`,
          threadId: scope.threadId,
          resourceId: scope.resourceId,
          role: 'assistant',
          createdAt: new Date(0),
          content: { format: 2, parts: [{ type: 'text', text: `Reply ${blockId}` }] },
        },
      ],
    })
  }
  const deleteThread = store.deleteThread.bind(store)
  vi.spyOn(store, 'deleteThread').mockImplementation(async (params) => {
    if (params.threadId === childHistory.threadId) throw new Error('Native cleanup failed')
    await deleteThread(params)
  })

  await expect(deleteAgentHistory(row)).rejects.toThrow('Native cleanup failed')
  expect(await store.getThreadById({ threadId: history.threadId })).toBeNull()
  const messages = vi.spyOn(store, 'listMessages')
  const result = await attachAgentHistory(row, 'actor')
  const span: TraceSpan = result.executionData.traceSpans[0]
  expect(span).toMatchObject({
    inference: { history },
    input: {},
    children: [{ agentHistory: [{ id: 'message-child' }] }],
  })
  expect(span.agentHistory).toBeUndefined()
  expect(messages).toHaveBeenCalledTimes(1)
  expect(messages).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: childHistory.threadId,
      resourceId: childHistory.resourceId,
    })
  )
})
it('still rejects revoked workspace access when native history has already been cleaned', async () => {
  fixture.thread.mockResolvedValue(null)
  fixture.access
    .mockResolvedValueOnce({ hasAccess: true })
    .mockResolvedValueOnce({ hasAccess: false })
  await expect(attachAgentHistory(log(), 'actor')).rejects.toThrow('revoked')
  expect(fixture.messages).not.toHaveBeenCalled()
})
it('does not treat native storage failures as completed history cleanup', async () => {
  fixture.thread.mockRejectedValueOnce(new Error('Native store unavailable'))
  await expect(attachAgentHistory(log(), 'actor')).rejects.toThrow('Native store unavailable')
  expect(fixture.messages).not.toHaveBeenCalled()
})
it('hydrates nested parallel histories and rejects references to another iteration', async () => {
  const children = [0, 1].map((iteration) => {
    const runId = `run-${iteration}`
    const blockId = `block_parallel_parallel_iteration_${iteration}`
    return {
      id: `occurrence-${iteration}`,
      blockId,
      type: 'agent',
      inference: { history: { ...history, runId, threadId: `workflow-agent:${runId}` } },
    }
  })
  const row = {
    ...log(),
    executionData: {
      traceSpans: [{ id: 'parallel', type: 'parallel', children }] as TraceSpan[],
    },
  }
  const owners = new Map(children.map((span) => [span.inference.history.threadId, span.blockId]))
  fixture.thread.mockImplementation(async ({ threadId }) => ({
    id: threadId,
    resourceId: history.resourceId,
    metadata: {
      purpose: 'workflow-agent',
      workspaceId: row.workspaceId,
      executionId: row.executionId,
      workflowId: row.workflowId,
      logId: row.id,
      blockId: owners.get(threadId),
      runId: threadId.slice('workflow-agent:'.length),
    },
  }))
  const hydrated = await attachAgentHistory(row, 'actor')
  expect(
    hydrated.executionData.traceSpans[0].children?.every((span) => span.agentHistory?.length)
  ).toBe(true)
  children[0].inference.history = children[1].inference.history
  await expect(attachAgentHistory(row, 'actor')).rejects.toThrow('owner')
})
it('discards native results if workspace access is revoked during the read', async () => {
  fixture.access
    .mockResolvedValueOnce({ hasAccess: true })
    .mockResolvedValueOnce({ hasAccess: false })
  await expect(attachAgentHistory(log(), 'actor')).rejects.toThrow('revoked')
})

it('keeps child workflow history within its own execution detail boundary', async () => {
  const row = log()
  row.executionData.traceSpans[0] = {
    ...row.executionData.traceSpans[0],
    type: 'workflow',
    inference: undefined,
    children: [
      {
        ...row.executionData.traceSpans[0],
        inference: { history: { ...history, resourceId: 'workflow-execution:workspace:child' } },
      },
    ],
  } as any
  const result = await attachAgentHistory(row, 'actor')
  expect(result.executionData.traceSpans).toEqual(row.executionData.traceSpans)
  expect(fixture.thread).not.toHaveBeenCalled()
})
