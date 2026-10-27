import type { MarketProviderConfig } from '@/providers/market/providers'

const gates = new Map<string, { ready: Promise<void>; startedAt?: number }>()

export async function fetchMarketProviderJson<T = unknown>(
  config: Pick<MarketProviderConfig, 'id' | 'name' | 'requestsPerMinute'>,
  apiKey: string | undefined,
  input: string,
  init?: RequestInit
): Promise<T> {
  const intervalMs = Math.ceil(60_000 / config.requestsPerMinute!)
  const key = JSON.stringify([config.id, apiKey])
  const gate = gates.get(key) ?? { ready: Promise.resolve(), startedAt: undefined }
  gates.set(key, gate)
  const request = gate.ready.then(async () => {
    if (gate.startedAt !== undefined) {
      const delay = gate.startedAt + intervalMs - Date.now()
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    }
    gate.startedAt = Date.now()
    return { response: fetch(input, init) }
  })
  // Release the queue when fetch starts, rather than when its response arrives.
  const ready = request.then(
    () => undefined,
    () => undefined
  )
  gate.ready = ready
  const launched = await request.finally(() => {
    if (gate.ready === ready) {
      const cleanup = setTimeout(() => {
        if (gates.get(key) === gate && gate.ready === ready) gates.delete(key)
      }, intervalMs)
      cleanup.unref?.()
    }
  })
  const response = await launched.response
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(message || `${config.name} request failed with status ${response.status}`)
  }
  return response.json()
}
