import { MARKET_API_URL_DEFAULT, MARKET_API_VERSION } from '@/lib/market/client/constants'
import { resolveMarketApiServiceConfig } from '@/lib/system-services/runtime'

type RemoteServiceKey = {
  id: string
  apiKey: string
}

async function createRequestInit(body?: Record<string, unknown>): Promise<RequestInit> {
  const marketApi = await resolveMarketApiServiceConfig()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (marketApi.apiKey) {
    headers['x-api-key'] = marketApi.apiKey
  }

  return {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, version: MARKET_API_VERSION }),
  }
}

async function getMarketApiUrl(endpoint: string) {
  const marketApi = await resolveMarketApiServiceConfig()
  return new URL(endpoint, marketApi.baseUrl || MARKET_API_URL_DEFAULT).toString()
}

export async function proxyMarketApiKeysRequest(endpoint: string, body?: Record<string, unknown>) {
  return fetch(await getMarketApiUrl(endpoint), await createRequestInit(body))
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
