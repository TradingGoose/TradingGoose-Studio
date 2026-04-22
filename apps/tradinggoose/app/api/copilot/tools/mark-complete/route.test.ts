/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createSseStream(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
}

describe('Copilot mark-complete API', () => {
  const mockAuthenticateCopilotRequestSessionOnly = vi.fn()
  const mockProxyCopilotRequest = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    mockAuthenticateCopilotRequestSessionOnly.mockReset()
    mockProxyCopilotRequest.mockReset()

    mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })

    vi.doMock('@/lib/copilot/auth', () => ({
      authenticateCopilotRequestSessionOnly: (...args: any[]) =>
        mockAuthenticateCopilotRequestSessionOnly(...args),
      createBadRequestResponse: vi.fn((message: string) =>
        Response.json({ error: message }, { status: 400 })
      ),
      createInternalServerErrorResponse: vi.fn((message: string) =>
        Response.json({ error: message }, { status: 500 })
      ),
      createRequestTracker: vi.fn(() => ({
        requestId: 'request-1',
      })),
      createUnauthorizedResponse: vi.fn(() =>
        Response.json({ error: 'Unauthorized' }, { status: 401 })
      ),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
    }))

    vi.doMock('@/app/api/copilot/proxy', () => ({
      getCopilotApiUrl: vi.fn(() => 'https://copilot.example.test/api/tools/mark-complete'),
      proxyCopilotRequest: (...args: any[]) => mockProxyCopilotRequest(...args),
    }))
  })

  it('passes through a continuation SSE stream from copilot', async () => {
    mockProxyCopilotRequest.mockResolvedValue(
      new Response(
        createSseStream([
          {
            type: 'response.output_item.added',
            item: {
              id: 'assistant-item-1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: '' }],
            },
          },
          {
            type: 'response.output_text.delta',
            item_id: 'assistant-item-1',
            delta: 'continued',
          },
          {
            type: 'response.output_item.done',
            item: {
              id: 'assistant-item-1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'continued' }],
            },
          },
          { type: 'response.completed', response: { id: 'response-continued' } },
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        }
      )
    )

    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest('http://localhost:3000/api/copilot/tools/mark-complete', {
        method: 'POST',
        body: JSON.stringify({
          id: 'tool-1',
          name: 'edit_workflow',
          status: 200,
          message: 'ok',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
    const responseText = await response.text()
    expect(responseText).toContain('"type":"turn_state"')
    expect(responseText).toContain('"phase":"streaming"')
    expect(responseText).toContain('"phase":"completed"')
    expect(responseText).toContain('"type":"response.output_item.added"')
    expect(await mockProxyCopilotRequest.mock.calls[0]?.[0]).toEqual({
      endpoint: '/api/tools/mark-complete',
      body: {
        id: 'tool-1',
        name: 'edit_workflow',
        status: 200,
        message: 'ok',
      },
    })
  })
})
