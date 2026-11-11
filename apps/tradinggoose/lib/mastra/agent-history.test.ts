import { beforeEach, expect, it, vi } from 'vitest'
import { attachAgentHistory } from './agent-history'

const fixture = vi.hoisted(() => ({ access: vi.fn(), thread: vi.fn(), messages: vi.fn() }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: fixture.access }))
vi.mock('./runtime', () => ({
  getNativeMemoryStore: async () => ({
    getThreadById: fixture.thread,
    listMessages: fixture.messages,
  }),
}))
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
beforeEach(() => {
  vi.clearAllMocks()
  fixture.access.mockResolvedValue({ hasAccess: true })
  fixture.thread.mockResolvedValue({
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
  fixture.messages.mockResolvedValue({
    messages: [
      {
        id: 'message',
        threadId: history.threadId,
        resourceId: history.resourceId,
        role: 'assistant',
        content: { format: 2, parts: [{ type: 'text', text: 'Exact reply' }] },
      },
    ],
    hasMore: false,
  })
})
it('returns the official persisted messages and selected instructions for authorized details', async () => {
  const result = await attachAgentHistory(log(), 'actor')
  expect(result.executionData.traceSpans[0]).toMatchObject({
    agentHistory: [{ id: 'message', content: { parts: [{ type: 'text', text: 'Exact reply' }] } }],
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
