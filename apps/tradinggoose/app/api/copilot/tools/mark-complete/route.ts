import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import { getCopilotApiUrl, proxyCopilotRequest } from '@/app/api/copilot/proxy'

const logger = createLogger('CopilotMarkToolCompleteAPI')
const DATA_PREFIX = 'data: '

const MarkCompleteSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.number().int(),
  message: z.any().optional(),
  data: z.any().optional(),
})

function createTurnStateStream(body: ReadableStream<Uint8Array>) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const enqueueTurnState = (
        status: 'in_progress' | 'completed' | 'error',
        phase: 'streaming' | 'waiting_for_tools' | 'completed' | 'error'
      ) => {
        controller.enqueue(
          encodeSSE({
            type: 'turn_state',
            status,
            phase,
          })
        )
      }

      const forwardEvent = (event: Record<string, unknown>) => {
        if (event.type === 'awaiting_tools') {
          enqueueTurnState('in_progress', 'waiting_for_tools')
        } else if (event.type === 'response.completed') {
          enqueueTurnState('completed', 'completed')
        } else if (event.type === 'error') {
          enqueueTurnState('error', 'error')
        }

        controller.enqueue(encodeSSE(event))
      }

      enqueueTurnState('in_progress', 'streaming')

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith(DATA_PREFIX) || line.length <= DATA_PREFIX.length) {
              continue
            }

            const payload = line.slice(DATA_PREFIX.length)
            if (payload === '[DONE]') {
              continue
            }

            const event = JSON.parse(payload) as Record<string, unknown>
            forwardEvent(event)
          }
        }

        if (buffer.startsWith(DATA_PREFIX) && buffer.length > DATA_PREFIX.length) {
          const payload = buffer.slice(DATA_PREFIX.length)
          if (payload === '[DONE]') {
            controller.close()
            return
          }

          const event = JSON.parse(payload) as Record<string, unknown>
          forwardEvent(event)
        }
      } catch (error) {
        controller.error(error)
        return
      } finally {
        reader = null
      }

      controller.close()
    },
    cancel() {
      if (reader) {
        void reader.cancel().catch(() => {})
      }
    },
  })
}

/**
 * POST /api/copilot/tools/mark-complete
 * Proxy to TradingGoose Agent: POST /api/tools/mark-complete
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const { userId, isAuthenticated } = await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !userId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()

    // Log raw body shape for diagnostics (avoid dumping huge payloads)
    try {
      const bodyPreview = JSON.stringify(body).slice(0, 300)
      logger.debug(`[${tracker.requestId}] Incoming mark-complete raw body preview`, {
        preview: `${bodyPreview}${bodyPreview.length === 300 ? '...' : ''}`,
      })
    } catch { }

    const parsed = MarkCompleteSchema.parse(body)

    const messagePreview = (() => {
      try {
        const s =
          typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed.message)
        return s ? `${s.slice(0, 200)}${s.length > 200 ? '...' : ''}` : undefined
      } catch {
        return undefined
      }
    })()

    logger.info(`[${tracker.requestId}] Forwarding tool mark-complete`, {
      userId,
      toolCallId: parsed.id,
      toolName: parsed.name,
      status: parsed.status,
      hasMessage: parsed.message !== undefined,
      hasData: parsed.data !== undefined,
      messagePreview,
      agentUrl: await getCopilotApiUrl('/api/tools/mark-complete'),
    })

    const agentRes = await proxyCopilotRequest({
      endpoint: '/api/tools/mark-complete',
      body: parsed,
    })

    const contentType = agentRes.headers.get('content-type') || ''
    if (agentRes.ok && contentType.includes('text/event-stream') && agentRes.body) {
      logger.info(`[${tracker.requestId}] Agent returned continuation stream`, {
        toolCallId: parsed.id,
        toolName: parsed.name,
      })
      return new NextResponse(createTurnStateStream(agentRes.body), {
        status: agentRes.status,
        headers: {
          ...SSE_HEADERS,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-transform',
        },
      })
    }

    // Attempt to parse agent response JSON
    let agentJson: any = null
    let agentText: string | null = null
    try {
      agentJson = await agentRes.json()
    } catch (_) {
      try {
        agentText = await agentRes.text()
      } catch { }
    }

    logger.info(`[${tracker.requestId}] Agent responded to mark-complete`, {
      status: agentRes.status,
      ok: agentRes.ok,
      responseJsonPreview: agentJson ? JSON.stringify(agentJson).slice(0, 300) : undefined,
      responseTextPreview: agentText ? agentText.slice(0, 300) : undefined,
    })

    if (agentRes.ok) {
      return NextResponse.json({ success: true })
    }

    const errorMessage =
      agentJson?.error || agentText || `Agent responded with status ${agentRes.status}`
    const status = agentRes.status >= 500 ? 500 : 400

    logger.warn(`[${tracker.requestId}] Mark-complete failed`, {
      status,
      error: errorMessage,
    })

    return NextResponse.json({ success: false, error: errorMessage }, { status })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${tracker.requestId}] Invalid mark-complete request body`, {
        issues: error.issues,
      })
      return createBadRequestResponse('Invalid request body for mark-complete')
    }
    logger.error(`[${tracker.requestId}] Failed to proxy mark-complete:`, error)
    return createInternalServerErrorResponse('Failed to mark tool as complete')
  }
}
