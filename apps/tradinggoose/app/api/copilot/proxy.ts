import { COPILOT_API_URL_DEFAULT, COPILOT_API_VERSION } from '@/lib/copilot/agent/constants'
import { resolveCopilotApiServiceConfig } from '@/lib/system-services/runtime'

const COMPLETION_API_VERSION = 'v1'

export type CopilotProxyRequest = {
  endpoint: string
  body?: Record<string, unknown>
  signal?: AbortSignal
  headers?: Record<string, string>
}

export type CopilotCompletionRequest = {
  body?: Record<string, unknown>
  signal?: AbortSignal
  headers?: Record<string, string>
}

type CopilotQuery = Record<string, string | number | boolean | null | undefined>

async function createRequestInit(
  body: Record<string, unknown> | undefined,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<RequestInit> {
  const copilotApi = await resolveCopilotApiServiceConfig()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const apiKey = copilotApi.apiKey
  if (apiKey) {
    headers['x-api-key'] = apiKey
  }
  Object.assign(headers, extraHeaders)

  return {
    method: 'POST',
    headers,
    signal,
    body: body ? JSON.stringify(body) : undefined,
  }
}

export async function getCopilotApiUrl(endpoint: string, query?: CopilotQuery) {
  const copilotApi = await resolveCopilotApiServiceConfig()
  const url = new URL(endpoint, copilotApi.baseUrl || COPILOT_API_URL_DEFAULT)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export async function proxyCopilotRequest({ endpoint, body, signal, headers }: CopilotProxyRequest) {
  return fetch(
    await getCopilotApiUrl(endpoint),
    await createRequestInit(
      body ? { ...body, version: COPILOT_API_VERSION } : undefined,
      signal,
      headers
    )
  )
}

export async function proxyCopilotCompletionRequest({
  body,
  signal,
  headers,
}: CopilotCompletionRequest) {
  return fetch(
    await getCopilotApiUrl('/api/completion', { version: COMPLETION_API_VERSION }),
    await createRequestInit(body, signal, headers)
  )
}
