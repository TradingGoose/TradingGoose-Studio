import { COPILOT_API_URL_DEFAULT, COPILOT_API_VERSION } from '@/lib/copilot/agent/constants'
import { env } from '@/lib/env'

const COPILOT_API_URL = env.COPILOT_API_URL || COPILOT_API_URL_DEFAULT
const COMPLETION_API_VERSION = 'v1'

export type CopilotProxyRequest = {
  endpoint: string
  body?: Record<string, unknown>
  signal?: AbortSignal
}

export type CopilotCompletionRequest = {
  body?: Record<string, unknown>
  signal?: AbortSignal
}

type CopilotQuery = Record<string, string | number | boolean | null | undefined>

function createRequestInit(
  body: Record<string, unknown> | undefined,
  signal?: AbortSignal
): RequestInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = env.COPILOT_API_KEY || env.INTERNAL_API_SECRET
  if (apiKey) {
    headers['x-api-key'] = apiKey
  }

  return {
    method: 'POST',
    headers,
    signal,
    body: body ? JSON.stringify(body) : undefined,
  }
}

export function getCopilotApiUrl(endpoint: string, query?: CopilotQuery) {
  const url = new URL(endpoint, COPILOT_API_URL)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export function proxyCopilotRequest({ endpoint, body, signal }: CopilotProxyRequest) {
  return fetch(
    getCopilotApiUrl(endpoint),
    createRequestInit(body ? { ...body, version: COPILOT_API_VERSION } : undefined, signal)
  )
}

export function proxyCopilotCompletionRequest({ body, signal }: CopilotCompletionRequest) {
  return fetch(
    getCopilotApiUrl('/api/completion', { version: COMPLETION_API_VERSION }),
    createRequestInit(body, signal)
  )
}
