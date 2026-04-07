import { env } from '@/lib/env'
import { MARKET_API_URL_DEFAULT, MARKET_API_VERSION } from '@/lib/market/client/constants'

const MARKET_API_URL = env.MARKET_API_URL || MARKET_API_URL_DEFAULT

type RemoteServiceKey = {
  id: string
  apiKey: string
}

function createRequestInit(body?: Record<string, unknown>): RequestInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (env.MARKET_API_KEY) {
    headers['x-api-key'] = env.MARKET_API_KEY
  }

  return {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, version: MARKET_API_VERSION }),
  }
}

function getMarketApiUrl(endpoint: string) {
  return new URL(endpoint, MARKET_API_URL).toString()
}

export function proxyMarketApiKeysRequest(endpoint: string, body?: Record<string, unknown>) {
  return fetch(getMarketApiUrl(endpoint), createRequestInit(body))
}

export function maskServiceKeys(apiKeys: RemoteServiceKey[]) {
  return apiKeys.map((key) => {
    const last6 = key.apiKey.slice(-6)
    return {
      id: key.id,
      displayKey: `•••••${last6}`,
    }
  })
}
