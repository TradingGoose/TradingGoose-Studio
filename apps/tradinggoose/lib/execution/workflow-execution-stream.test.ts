/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorkflowExecutionEventStream } from './workflow-execution-stream'

const { readWorkflowExecutionEventStateMock } = vi.hoisted(() => ({
  readWorkflowExecutionEventStateMock: vi.fn(),
}))

vi.mock('@/lib/execution/workflow-execution-events', () => ({
  readWorkflowExecutionEventState: readWorkflowExecutionEventStateMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
  })),
}))

const params = { pendingExecutionId: 'execution-1', workflowId: 'workflow-1' }

describe('openWorkflowExecutionEventStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns notFound before opening an SSE stream for missing executions', async () => {
    readWorkflowExecutionEventStateMock.mockResolvedValue(null)

    const result = await openWorkflowExecutionEventStream(params)

    expect(result).toEqual({ ok: false, reason: 'notFound' })
    expect(readWorkflowExecutionEventStateMock).toHaveBeenCalledTimes(1)
    expect(readWorkflowExecutionEventStateMock).toHaveBeenCalledWith({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
      afterEventId: 0,
    })
  })

  it.each([
    ['completed', false],
    ['failed', false],
    ['paused', false],
    ['paused', true],
  ] as const)(
    'ends a %s segment with exactly one matching event and no extra polling (buffered=%s)',
    async (status, buffered) => {
      const error = status === 'failed' ? 'Workflow execution was cancelled' : undefined
      const result = {
        success: !error,
        ...(status === 'paused' ? { status } : {}),
        ...(error ? { error } : {}),
        output: status === 'paused' ? { revision: 2, url: '/review' } : { ok: true },
        logs: [],
      }
      const eventType = error ? 'execution:cancelled' : `execution:${status}`
      readWorkflowExecutionEventStateMock.mockResolvedValue({
        status,
        result,
        failureReason: error ?? null,
        events: buffered
          ? [
              {
                eventId: 3,
                event: {
                  type: eventType,
                  executionId: 'execution-1',
                  workflowId: 'workflow-1',
                  timestamp: new Date().toISOString(),
                  eventId: 3,
                  data: { result },
                },
              },
            ]
          : [],
      })

      const opened = await openWorkflowExecutionEventStream(params)
      expect(opened.ok).toBe(true)
      if (!opened.ok) throw new Error('Expected execution stream')
      const text = await new Response(opened.stream).text()

      expect(text.match(new RegExp(`"type":"${eventType}"`, 'g'))).toHaveLength(1)
      for (const other of ['completed', 'cancelled', 'paused', 'error']) {
        if (`execution:${other}` !== eventType) expect(text).not.toContain(`execution:${other}`)
      }
      if (status === 'paused') expect(text).toContain('"status":"paused"')
      if (status === 'completed') expect(text).toContain('"ok":true')
      expect(text).toContain('data: [DONE]')
      expect(readWorkflowExecutionEventStateMock).toHaveBeenCalledTimes(1)
    }
  )
})
