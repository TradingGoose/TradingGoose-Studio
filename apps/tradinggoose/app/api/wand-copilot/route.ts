import { randomUUID } from 'node:crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { fetchNativeCompletion } from '@/lib/copilot/native/client'
import {
  assertNativeCorrelation,
  COPILOT_NATIVE_REVISION,
  type CompletionRequest,
  parseNativeContract,
} from '@/lib/copilot/native/contract'
import { relayNativeEvents } from '@/lib/copilot/native/stream'
import { DEFAULT_COPILOT_RUNTIME_MODEL } from '@/lib/copilot/runtime-models'
import { createLogger } from '@/lib/logs/console/logger'
import { SSE_HEADERS } from '@/lib/utils'

const logger = createLogger('WandCopilot')

const WandRequestSchema = z
  .object({
    prompt: z.string().min(1, 'Prompt is required.'),
    systemPrompt: z.string().optional(),
    generationType: z.string().optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant', 'system', 'tool']),
          content: z.string(),
        })
      )
      .optional(),
  })
  .strict()

function buildGenerationTypeContract(generationType?: string): string | null {
  switch (generationType) {
    case 'json-object':
    case 'json-schema':
    case 'custom-tool-schema':
    case 'mongodb-filter':
    case 'mongodb-sort':
    case 'mongodb-update':
    case 'neo4j-parameters':
      return [
        'STRICT OUTPUT CONTRACT:',
        'Return ONLY a single valid JSON object.',
        'Do NOT include markdown, code fences, commentary, labels, or any text before or after the JSON.',
        'The response must start with { and end with }.',
      ].join('\n')
    case 'mongodb-pipeline':
    case 'mongodb-documents':
      return [
        'STRICT OUTPUT CONTRACT:',
        'Return ONLY a single valid JSON array.',
        'Do NOT include markdown, code fences, commentary, labels, or any text before or after the JSON.',
        'The response must start with [ and end with ].',
      ].join('\n')
    case 'javascript-function-body':
    case 'typescript-function-body':
      return [
        'STRICT OUTPUT CONTRACT:',
        'Return ONLY the raw function body.',
        'Do NOT include markdown, code fences, explanations, or the surrounding function signature.',
      ].join('\n')
    case 'sql-query':
      return [
        'STRICT OUTPUT CONTRACT:',
        'Return ONLY the raw SQL query text.',
        'Do NOT include markdown, code fences, explanations, comments about the query, or any surrounding prose.',
      ].join('\n')
    case 'postgrest':
      return [
        'STRICT OUTPUT CONTRACT:',
        'Return ONLY the raw PostgREST filter expression.',
        'Do NOT include markdown, code fences, explanations, quotes around the full expression, or any surrounding prose.',
      ].join('\n')
    case 'neo4j-cypher':
      return [
        'STRICT OUTPUT CONTRACT:',
        'Return ONLY the raw Cypher query.',
        'Do NOT include markdown, code fences, explanations, or any surrounding prose.',
      ].join('\n')
    default:
      return null
  }
}

function buildWandSystemPrompt(systemPrompt?: string, generationType?: string): string | null {
  const basePrompt = systemPrompt?.trim() || null
  const contract = buildGenerationTypeContract(generationType)

  if (basePrompt && contract) {
    return `${basePrompt}\n\n${contract}`
  }

  if (basePrompt) {
    return basePrompt
  }

  return contract
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

  const { prompt, systemPrompt, generationType, history } = parsed.data
  const configuredModel = DEFAULT_COPILOT_RUNTIME_MODEL
  const finalSystemPrompt = buildWandSystemPrompt(systemPrompt, generationType)
  const messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> = [
    ...(finalSystemPrompt ? [{ role: 'system' as const, content: finalSystemPrompt }] : []),
    ...(history || []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: 'user' as const, content: prompt },
  ]

  const requestId = randomUUID()
  const nativeRequest: CompletionRequest = {
    protocolRevision: COPILOT_NATIVE_REVISION,
    requestId,
    scope: { actorUserId: session.user.id, workspaceId: null },
    purpose: 'wand',
    model: configuredModel,
    messages: [messages[0]!, ...messages.slice(1)],
    stream: true,
  }
  const abort = new AbortController()
  const signal = AbortSignal.any([req.signal, abort.signal])
  let upstream: Response
  try {
    upstream = await fetchNativeCompletion(nativeRequest, signal)
  } catch (error) {
    logger.error('Native wand connection failed', { error })
    return NextResponse.json({ error: 'Failed to connect to Copilot' }, { status: 502 })
  }
  if (!upstream.ok) {
    try {
      const failure = await parseNativeContract('CompletionFailureResponse', await upstream.json())
      assertNativeCorrelation(failure, requestId)
      return NextResponse.json(failure, {
        status: upstream.status,
        headers: { 'x-wand-request-id': requestId },
      })
    } catch {
      return NextResponse.json({ error: 'Invalid native completion failure' }, { status: 502 })
    }
  }
  if (!upstream.body) {
    return NextResponse.json({ error: 'Copilot stream is empty' }, { status: 502 })
  }
  const stream = relayNativeEvents(upstream.body, 'CompletionEvent', {
    requestId,
    signal: req.signal,
    abortUpstream: () => abort.abort(),
  })
  return new Response(stream, {
    headers: {
      ...SSE_HEADERS,
      'Cache-Control': 'no-cache, no-transform',
      'x-wand-request-id': requestId,
    },
  })
}
