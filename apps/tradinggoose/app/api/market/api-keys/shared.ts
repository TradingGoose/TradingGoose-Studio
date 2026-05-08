import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { requestTradingGooseMarket } from '@/lib/market/request-gate'

type RemoteServiceKey = {
  id: string
  apiKey: string
}

function createRequestInit(body?: Record<string, unknown>): RequestInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  return {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, version: MARKET_API_VERSION }),
  }
}

export async function proxyMarketApiKeysRequest(endpoint: string, body?: Record<string, unknown>) {
  return requestTradingGooseMarket(endpoint, createRequestInit(body))
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
