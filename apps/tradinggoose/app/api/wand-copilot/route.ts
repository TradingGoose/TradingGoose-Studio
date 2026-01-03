import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getSession } from '@/lib/auth'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import { COPILOT_API_URL_DEFAULT } from '@/lib/copilot/agent/constants'

const logger = createLogger('WandCopilot')
const COPILOT_API_URL = env.COPILOT_API_URL || COPILOT_API_URL_DEFAULT
const COPILOT_API_KEY = env.COPILOT_API_KEY || env.INTERNAL_API_SECRET

const WandRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required.'),
  systemPrompt: z.string().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system', 'tool']),
        content: z.string(),
      })
    )
    .optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsedBody
  try {
    parsedBody = await req.json()
  } catch (error) {
    logger.warn('Failed to parse wand payload', { error })
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const parsed = WandRequestSchema.safeParse(parsedBody)
  if (!parsed.success) {
    logger.warn('Invalid wand payload', { issues: parsed.error.issues })
    return NextResponse.json(
      {
        error: 'Invalid wand payload',
        details: parsed.error.issues,
      },
      { status: 400 }
    )
  }

  const { prompt, systemPrompt, history } = parsed.data

  const copilotPayload: Record<string, any> = {
    message: prompt,
    workflowId: 'wand',
    userId: session.user.id,
    stream: true,
    streamToolCalls: false,
    mode: 'wand',
  }

  if (systemPrompt) {
    copilotPayload.systemPrompt = systemPrompt
  }
  if (history && history.length > 0) {
    copilotPayload.history = history
  }
  if (session.user.name) {
    copilotPayload.userName = session.user.name
  }
  if (env.WAND_OPENAI_MODEL_NAME) {
    copilotPayload.model = env.WAND_OPENAI_MODEL_NAME
  }

  let copilotResponse: Response
  try {
    copilotResponse = await fetch(`${COPILOT_API_URL}/api/chat-completion-streaming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(COPILOT_API_KEY ? { 'x-api-key': COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(copilotPayload),
      signal: req.signal,
    })
  } catch (error) {
    logger.error('Failed to proxy wand stream', { error })
    return NextResponse.json({ error: 'Failed to connect to Copilot' }, { status: 502 })
  }

  if (!copilotResponse.ok) {
    const errorText = await copilotResponse.text().catch(() => '')
    logger.error('Copilot wand proxy returned error', {
      status: copilotResponse.status,
      errorText,
    })
    return NextResponse.json(
      { error: errorText || 'Copilot responded with an error' },
      { status: copilotResponse.status }
    )
  }

  if (!copilotResponse.body) {
    return NextResponse.json({ error: 'Copilot stream is empty' }, { status: 500 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = copilotResponse.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const segments = buffer.split('\n\n')
          buffer = segments.pop() || ''

          for (const segment of segments) {
            const trimmed = segment.trim()
            if (!trimmed) {
              continue
            }

            const lines = trimmed.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data:')) {
                continue
              }
              const payload = line.slice(5).trim()

              if (!payload) {
                continue
              }

              if (payload === '[DONE]') {
                controller.enqueue(encodeSSE({ done: true }))
                continue
              }

              let parsedEvent
              try {
                parsedEvent = JSON.parse(payload)
              } catch (parseError) {
                logger.debug('Failed to parse copilot SSE payload', { parseError, payload })
                continue
              }

              if (parsedEvent.type === 'content' && typeof parsedEvent.data === 'string') {
                controller.enqueue(encodeSSE({ chunk: parsedEvent.data }))
                continue
              }

              if (parsedEvent.type === 'error') {
                controller.enqueue(
                  encodeSSE({ error: parsedEvent.data || parsedEvent.error || payload })
                )
                continue
              }

              if (parsedEvent.type === 'done' || parsedEvent.type === 'stream_end') {
                controller.enqueue(encodeSSE({ done: true }))
                continue
              }
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Streaming error'
        controller.enqueue(encodeSSE({ error: message }))
        logger.error('Error while streaming wand proxy response', { error })
      } finally {
        reader.releaseLock()
        if (buffer.trim()) {
          try {
            const parsedEvent = JSON.parse(buffer.trim())
            if (parsedEvent && typeof parsedEvent === 'object' && parsedEvent.chunk) {
              controller.enqueue(encodeSSE({ chunk: parsedEvent.chunk }))
            }
          } catch {
            // ignore
          }
        }
        controller.enqueue(encodeSSE({ done: true }))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...SSE_HEADERS,
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
