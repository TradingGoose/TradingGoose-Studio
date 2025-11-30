import { env } from 'bun'

interface UnkeyVerifyResponse {
  valid: boolean
  key?: {
    id?: string
    name?: string
    namespaceId?: string
    meta?: Record<string, any>
  }
  error?: string
}

/**
 * Validate an API key using Unkey.
 * Returns { valid, userId?, keyId? }
 */
export async function validateUnkeyKey(apiKey: string | null): Promise<{
  valid: boolean
  userId?: string
  keyId?: string
}> {
  if (!apiKey || !env.UNKEY_ROOT_KEY) {
    return { valid: false }
  }

  try {
    const res = await fetch('https://api.unkey.dev/v1/keys/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.UNKEY_ROOT_KEY}`,
      },
      body: JSON.stringify({ key: apiKey }),
    })

    if (!res.ok) {
      return { valid: false }
    }

    const data = (await res.json()) as UnkeyVerifyResponse
    if (!data.valid) return { valid: false }

    // Prefer a userId stored in meta
    const metaUserId = data.key?.meta?.userId || data.key?.meta?.user_id

    return { valid: true, userId: metaUserId, keyId: data.key?.id }
  } catch {
    return { valid: false }
  }
}

/**
 * Consume a rate limit bucket in Unkey for the provided key.
 * Returns allowed=false on any error to be conservative.
 */
export async function consumeUnkeyLimit(apiKey: string | null): Promise<{
  allowed: boolean
  remaining?: number
  reset?: number
  error?: string
}> {
  if (!apiKey || !env.UNKEY_ROOT_KEY) return { allowed: false, error: 'Missing key or UNKEY_ROOT_KEY' }
  const limitId = env.UNKEY_LIMIT_ID || 'copilot-default'
  try {
    const res = await fetch('https://api.unkey.dev/v1/limits/consume', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.UNKEY_ROOT_KEY}`,
      },
      body: JSON.stringify({
        key: apiKey,
        limit: { id: limitId },
      }),
    })
    if (!res.ok) {
      return { allowed: false, error: `Limit consume failed ${res.status}` }
    }
    const data: any = await res.json()
    if (data?.ok === false) {
      return { allowed: false, error: data?.error || 'Rate limit exceeded' }
    }
    const remaining = data?.remaining ?? data?.limit?.remaining
    const reset = data?.reset ?? data?.limit?.reset
    const allowed = data?.allowed ?? true
    return { allowed, remaining, reset }
  } catch (error: any) {
    return { allowed: false, error: error?.message || 'Rate limit error' }
  }
}
