import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { COPILOT_API_URL_DEFAULT, COPILOT_API_VERSION } from '@/lib/copilot/agent/constants'

const logger = createLogger('CopilotProxy')
const COPILOT_API_URL = env.COPILOT_API_URL || COPILOT_API_URL_DEFAULT

export type CopilotProxyOptions = {
  endpoint: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'
  body?: Record<string, any>
  headers?: Record<string, string>
  signal?: AbortSignal
  apiKey?: string
}

export function getCopilotApiUrl(endpoint: string) {
  return `${COPILOT_API_URL}${endpoint}`
}

export function withCopilotVersion(body?: Record<string, any>) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const version =
    typeof body.version === 'string' && body.version.trim().length > 0
      ? body.version
      : COPILOT_API_VERSION
  return { ...body, version }
}

export async function proxyCopilotRequest(options: CopilotProxyOptions) {
  const { endpoint, method = 'POST', body, headers = {}, signal, apiKey } = options
  const url = getCopilotApiUrl(endpoint)
  const payload = withCopilotVersion(body)
  const resolvedApiKey = apiKey || env.COPILOT_API_KEY || env.INTERNAL_API_SECRET

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }
  if (resolvedApiKey && !('x-api-key' in requestHeaders)) {
    requestHeaders['x-api-key'] = resolvedApiKey
  }

  logger.debug('Proxying copilot request', {
    method,
    endpoint,
  })

  const init: RequestInit = {
    method,
    headers: requestHeaders,
    signal,
  }
  if (payload && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(payload)
  }

  return fetch(url, init)
}
