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
        return Response.json({
          success: true,
          taskId: 'execution-1',
          executionId: 'execution-1',
        })
      }

      if (requestUrl === '/api/workflows/workflow-1/executions/execution-1/stream?from=0') {
        return new Response(
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
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        input: {},
        triggerType: 'manual',
        executionTarget: 'live',
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
})
