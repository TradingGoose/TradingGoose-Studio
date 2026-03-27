import type { ProviderId } from '@/providers/ai/types'

type CompletionContent =
  | string
  | Array<{
      text?: string
    }>
  | null
  | undefined

type CompletionPayload = {
  error?: string | { message?: string | null } | null
  choices?: Array<{
    message?: { content?: CompletionContent | null } | null
    delta?: { content?: CompletionContent | null } | null
  }>
} | null

function readCompletionContent(content: CompletionContent): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
}

export function formatCompletionModel(model: string, provider: ProviderId): string {
  return model.includes('/') ? model : `${provider}/${model}`
}

function asCompletionPayload(payload: unknown): CompletionPayload {
  return payload && typeof payload === 'object' ? (payload as CompletionPayload) : null
}

export function readCompletionMessageText(payload: unknown): string {
  return readCompletionContent(asCompletionPayload(payload)?.choices?.[0]?.message?.content).trim()
}

export function readCompletionDeltaText(payload: unknown): string {
  return readCompletionContent(asCompletionPayload(payload)?.choices?.[0]?.delta?.content)
}

export function readCompletionError(payload: unknown): string | null {
  const error = asCompletionPayload(payload)?.error
  if (typeof error === 'string') {
    return error || null
  }

  return typeof error?.message === 'string' && error.message ? error.message : null
}
