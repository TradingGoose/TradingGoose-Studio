import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  formatCompletionModel,
  readCompletionDeltaText,
  readCompletionError,
} from '@/lib/copilot/completion'
import { getCopilotModel } from '@/lib/copilot/config'
import { createLogger } from '@/lib/logs/console/logger'
import { encodeSSE, SSE_HEADERS } from '@/lib/utils'
import { proxyCopilotCompletionRequest } from '@/app/api/copilot/proxy'

const logger = createLogger('WandCopilot')

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

function relayCompletionSegment(
  rawSegment: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): boolean {
  if (!rawSegment.trim()) {
    return false
  }

  let sawDone = false
  for (const line of rawSegment.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data) {
      continue
    }

    if (data === '[DONE]') {
      controller.enqueue(encodeSSE({ done: true }))
      sawDone = true
      continue
    }

    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }

    const errorMessage = readCompletionError(payload)
    if (errorMessage) {
      controller.enqueue(encodeSSE({ error: errorMessage }))
      continue
    }

    const contentChunk = readCompletionDeltaText(payload)
    if (contentChunk) {
      controller.enqueue(encodeSSE({ chunk: contentChunk }))
    }
  }

  return sawDone
}

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
  const defaultModel = getCopilotModel('chat')
  const configuredModel = defaultModel.model
  const configuredProvider = defaultModel.provider
  const messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...(history || []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: 'user' as const, content: prompt },
  ]

  let copilotResponse: Response
  try {
    copilotResponse = await proxyCopilotCompletionRequest({
      body: {
        model: formatCompletionModel(configuredModel, configuredProvider),
        stream: true,
        messages,
      },
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
      let didSendDone = false

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
            didSendDone = relayCompletionSegment(segment, controller) || didSendDone
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Streaming error'
        controller.enqueue(encodeSSE({ error: message }))
        logger.error('Error while streaming wand proxy response', { error })
      } finally {
        reader.releaseLock()
        if (buffer.trim()) {
          didSendDone = relayCompletionSegment(buffer, controller) || didSendDone
        }
        if (!didSendDone) {
          controller.enqueue(encodeSSE({ done: true }))
        }
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
