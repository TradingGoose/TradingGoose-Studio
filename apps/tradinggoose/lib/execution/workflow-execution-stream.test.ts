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

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

describe('openWorkflowExecutionEventStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns notFound before opening an SSE stream for missing executions', async () => {
    readWorkflowExecutionEventStateMock.mockResolvedValue(null)

    const result = await openWorkflowExecutionEventStream({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
    })

    expect(result).toEqual({ ok: false, reason: 'notFound' })
    expect(readWorkflowExecutionEventStateMock).toHaveBeenCalledTimes(1)
    expect(readWorkflowExecutionEventStateMock).toHaveBeenCalledWith({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
      afterEventId: 0,
    })
  })

  it('streams the initial event-state read without polling the same state again', async () => {
    readWorkflowExecutionEventStateMock.mockResolvedValue({
      status: 'completed',
      result: { success: true, output: {}, logs: [] },
      errorMessage: null,
      events: [
        {
          eventId: 1,
          event: {
            type: 'execution:completed',
            executionId: 'execution-1',
            workflowId: 'workflow-1',
            timestamp: '2026-01-01T00:00:00.000Z',
            eventId: 1,
            data: {
              result: { success: true, output: {}, logs: [] },
            },
          },
        },
      ],
    })

    const result = await openWorkflowExecutionEventStream({
      pendingExecutionId: 'execution-1',
      workflowId: 'workflow-1',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const text = await readStream(result.stream)

    expect(text).toContain('"type":"execution:completed"')
    expect(text).toContain('data: [DONE]')
    expect(readWorkflowExecutionEventStateMock).toHaveBeenCalledTimes(1)
  })
})
