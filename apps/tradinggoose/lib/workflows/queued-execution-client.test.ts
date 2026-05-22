/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runQueuedWorkflowExecution } from './queued-execution-client'

describe('runQueuedWorkflowExecution', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('cancels the queued job when the execution signal aborts', async () => {
    const abortController = new AbortController()
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString()

      if (requestUrl === '/api/workflows/workflow-1/queue') {
        return new Response(
          new ReadableStream({
            start(controller) {
              setTimeout(() => {
                abortController.abort()
                controller.error(new DOMException('Aborted', 'AbortError'))
              }, 0)
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'X-Execution-Id': 'execution-1',
              'X-Task-Id': 'execution-1',
            },
          }
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
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        input: {},
        triggerType: 'manual',
        executionTarget: 'live',
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

  it('polls job status for non-stream queued executions', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = url.toString()

      if (requestUrl === '/api/workflows/workflow-1/queue') {
        return Response.json({
          success: true,
          taskId: 'execution-1',
          executionId: 'execution-1',
        })
      }

      if (requestUrl === '/api/jobs/execution-1') {
        return Response.json({
          success: true,
          status: 'completed',
          output: {
            success: true,
            output: { value: 42 },
          },
        })
      }

      throw new Error(`Unexpected fetch ${requestUrl}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      runQueuedWorkflowExecution({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        input: {},
        triggerType: 'manual',
        executionTarget: 'live',
      })
    ).resolves.toMatchObject({
      success: true,
      output: { value: 42 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads workflow execution events from the queue response stream', async () => {
    const onEvent = vi.fn()
    const started = {
      type: 'execution:started',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      eventId: 1,
      timestamp: new Date().toISOString(),
      data: {
        startTime: new Date().toISOString(),
      },
    }
    const completed = {
      type: 'execution:completed',
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      eventId: 2,
      timestamp: new Date().toISOString(),
      data: {
        result: {
          success: true,
          output: { value: 42 },
          logs: [],
        },
      },
    }
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = url.toString()

      if (requestUrl === '/api/workflows/workflow-1/queue') {
        return new Response(
          `data: ${JSON.stringify(started)}\n\ndata: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`,
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'X-Execution-Id': 'execution-1',
              'X-Task-Id': 'execution-1',
            },
          }
        )
      }

      throw new Error(`Unexpected fetch ${requestUrl}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(
      runQueuedWorkflowExecution(
        {
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          input: {},
          triggerType: 'manual',
          executionTarget: 'live',
          stream: true,
        },
        { onEvent }
      )
    ).resolves.toMatchObject({
      success: true,
      output: { value: 42 },
    })

    expect(onEvent).toHaveBeenCalledWith(started)
    expect(onEvent).toHaveBeenCalledWith(completed)
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      input: {},
      triggerType: 'manual',
      executionTarget: 'live',
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
})
