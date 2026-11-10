import { COPILOT_API_URL_DEFAULT } from '@/lib/copilot/agent/constants'
import { resolveCopilotApiServiceConfig } from '@/lib/system-services/runtime'
import {
  assertNativeCommandResponse,
  assertNativeCorrelation,
  COPILOT_NATIVE_API_VERSION,
  type CompletionRequest,
  type CopilotRequest,
  parseNativeContract,
} from './contract'

/** Fixed, server-owned service transport. Request IDs correlate; they never authorize inference replay. */
async function post(
  endpoint: '/api/copilot' | '/api/completion',
  body: CopilotRequest | CompletionRequest,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const config = await resolveCopilotApiServiceConfig()
  if (!config.apiKey?.trim()) {
    throw Object.assign(new Error('Copilot service authentication is unavailable'), { status: 503 })
  }
  const url = new URL(endpoint, config.baseUrl || COPILOT_API_URL_DEFAULT)
  url.searchParams.set('version', COPILOT_NATIVE_API_VERSION)
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey },
    body: JSON.stringify(body),
    signal,
  })
}

export async function fetchNativeCopilot(request: CopilotRequest, signal?: AbortSignal) {
  return post('/api/copilot', await parseNativeContract('CopilotRequest', request), signal)
}

export async function fetchNativeCompletion(request: CompletionRequest, signal?: AbortSignal) {
  return post('/api/completion', await parseNativeContract('CompletionRequest', request), signal)
}

/** Collected commands retain refused/failed outcomes and known facts; no implicit retry. */
export async function readNativeCopilot(request: CopilotRequest, signal?: AbortSignal) {
  const response = await fetchNativeCopilot(request, signal)
  const result = await parseNativeContract('CopilotResponse', await response.json())
  assertNativeCorrelation(result, request.requestId)
  assertNativeCommandResponse(request.command, result)
  return { status: response.status, result }
}
