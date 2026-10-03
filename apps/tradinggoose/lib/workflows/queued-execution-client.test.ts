/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runQueuedWorkflowExecution } from './queued-execution-client'

const runParams = {
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  input: {},
  triggerType: 'manual' as const,
  executionTarget: 'live' as const,
}
const streamResponse = (body: ConstructorParameters<typeof Response>[0]) =>
  new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Execution-Id': 'execution-1',
      'X-Task-Id': 'execution-1',
    },
  })

describe('runQueuedWorkflowExecution', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('cancels the queued job when the execution signal aborts', async () => {
    const abortController = new AbortController()
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString()

      if (requestUrl === '/api/workflows/workflow-1/queue') {
        return streamResponse(
          new ReadableStream({
            start(controller) {
              setTimeout(() => {
                abortController.abort()
                controller.error(new DOMException('Aborted', 'AbortError'))
              }, 0)
            },
          })
        )
      }

      if (requestUrl === '/api/jobs/execution-1') {
        return Response.json({ success: true, status: 'cancelling' })
      }

      throw new Error(`Unexpected fetch ${requestUrl} ${init?.method ?? 'GET'}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      runQueuedWorkflowExecution({
        ...runParams,
        stream: true,
        signal: abortController.signal,
      })
    ).rejects.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/jobs/execution-1',
      expect.objectContaining({
        method: 'DELETE',
      })
    )
  })

  it('cancels when the signal aborts while enqueue is in flight', async () => {
    const abortController = new AbortController()
    let releaseQueue!: () => void
    const queueStarted = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const requestUrl = url.toString()

      if (requestUrl === '/api/workflows/workflow-1/queue') {
        expect(init?.signal).toBeUndefined()
        await queueStarted
        return Response.json({
          success: true,
          taskId: 'execution-1',
          executionId: 'execution-1',
        })
      }

      if (requestUrl === '/api/jobs/execution-1' && init?.method === 'DELETE') {
        return Response.json({ success: true, status: 'cancelling' })
      }

      throw new Error(`Unexpected fetch ${requestUrl} ${init?.method ?? 'GET'}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const runPromise = runQueuedWorkflowExecution({
      ...runParams,
      signal: abortController.signal,
    })

    abortController.abort()
    releaseQueue()

    await expect(runPromise).rejects.toThrow('Aborted')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/jobs/execution-1',
      expect.objectContaining({
        method: 'DELETE',
      })
    )
  })

  it.each([
    { status: 'completed', stream: false },
    { status: 'completed', stream: true },
    { status: 'paused', stream: false },
    { status: 'paused', stream: true },
  ])(
    'returns $status results with ordered events and removes cancellation listeners (stream=$stream)',
    async ({ status, stream }) => {
      const controller = new AbortController()
      const result = {
        success: true,
        ...(status === 'paused' ? { status } : {}),
        output: status === 'paused' ? { url: '/review', revision: 2 } : { value: 42 },
        logs: [],
      }
      const finalEvent = {
        type: `execution:${status}`,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        timestamp: new Date().toISOString(),
        eventId: 2,
        data: { result },
      }
      const started = {
        ...finalEvent,
        type: 'execution:started',
        eventId: 1,
        data: { startTime: finalEvent.timestamp },
      }
      const events = status === 'completed' ? [started, finalEvent] : [finalEvent]
      const onEvent = vi.fn()
      const fetchMock = vi.fn(async (url: string | URL | Request) => {
        if (url.toString() === '/api/workflows/workflow-1/queue') {
          return stream
            ? streamResponse(
                events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
                  'data: [DONE]\n\n'
              )
            : Response.json({ success: true, taskId: 'execution-1', executionId: 'execution-1' })
        }
        if (!stream && url.toString() === '/api/jobs/execution-1') {
          return Response.json({ success: true, status, output: result })
        }
        throw new Error(`Unexpected fetch ${url}`)
      })
      global.fetch = fetchMock as unknown as typeof fetch

      await expect(
        runQueuedWorkflowExecution(
          {
            ...runParams,
            stream,
            signal: controller.signal,
          },
          { onEvent }
        )
      ).resolves.toEqual(result)

      expect(fetchMock).toHaveBeenCalledTimes(stream ? 1 : 2)
      expect(onEvent.mock.calls).toEqual(stream ? events.map((event) => [event]) : [])
      controller.abort()
      await Promise.resolve()
      expect(fetchMock).toHaveBeenCalledTimes(stream ? 1 : 2)
    }
  )
})
