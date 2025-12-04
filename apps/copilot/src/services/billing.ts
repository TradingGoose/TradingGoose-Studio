import { env } from 'bun'

export const billingConfig = {
  internalApiSecret: env.INTERNAL_API_SECRET || '',
  officialTgUrl: env.OFFICIAL_TG_URL || '',
}

export async function validateUsageLimit(params: {
  userId: string
  officialTgUrl: string
  internalApiSecret: string
}): Promise<{ allowed: boolean; status?: number; error?: string }> {
  const { userId, officialTgUrl, internalApiSecret } = params
  try {
    const url = officialTgUrl.endsWith('/')
      ? `${officialTgUrl}api/copilot/api-keys/validate`
      : `${officialTgUrl}/api/copilot/api-keys/validate`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': internalApiSecret,
      },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      return { allowed: false, status: res.status, error: `Validate failed ${res.status}` }
    }
    return { allowed: true, status: res.status }
  } catch (error: any) {
    return { allowed: false, error: error?.message || 'Validate failed' }
  }
}

export async function postContextUsage(params: {
  chatId: string
  model: string
  workflowId: string
  userId: string
  provider?: any
  assistantMessageId?: string
}): Promise<{ success: boolean; status?: number; error?: string; data?: any }> {
  const { chatId, model, workflowId, userId, provider, assistantMessageId } = params
  const { officialTgUrl, internalApiSecret } = billingConfig
  if (!officialTgUrl || !internalApiSecret) {
    return { success: false, error: 'Billing config missing' }
  }

  try {
    const url = officialTgUrl.endsWith('/')
      ? `${officialTgUrl}api/copilot/context-usage`
      : `${officialTgUrl}/api/copilot/context-usage`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': internalApiSecret,
      },
      body: JSON.stringify({
        chatId,
        model,
        workflowId,
        provider,
        bill: true,
        assistantMessageId,
        billingModel: model,
        userId,
      }),
    })
    if (!res.ok) {
      return { success: false, status: res.status, error: `Context usage failed ${res.status}` }
    }
    const data = await res.json().catch(() => null)
    return { success: true, status: res.status, data }
  } catch (error: any) {
    return { success: false, error: error?.message || 'Context usage failed' }
  }
}
