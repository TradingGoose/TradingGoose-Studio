import { useQuery } from '@tanstack/react-query'
import type { AdminBillingSnapshot } from '@/lib/admin/billing/types'

const ADMIN_BILLING_ENDPOINT = '/api/admin/billing'
export const ADMIN_BILLING_SETTINGS_ENDPOINT = '/api/admin/billing/settings'
export const ADMIN_BILLING_TIERS_ENDPOINT = '/api/admin/billing/tiers'

export const adminBillingKeys = {
  all: ['admin-billing'] as const,
  snapshot: () => [...adminBillingKeys.all, 'snapshot'] as const,
}

async function parseResponse(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function fetchAdminBillingSnapshot(): Promise<AdminBillingSnapshot> {
  const response = await fetch(ADMIN_BILLING_ENDPOINT, {
    cache: 'no-store',
  })

  const payload = await parseResponse(response)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : 'Failed to load admin billing'
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid admin billing snapshot payload')
  }

  return payload as AdminBillingSnapshot
}

export function useAdminBillingSnapshot() {
  return useQuery({
    queryKey: adminBillingKeys.snapshot(),
    queryFn: fetchAdminBillingSnapshot,
    staleTime: 30 * 1000,
  })
}

export async function sendAdminBillingMutationRequest(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  const payload = await parseResponse(response)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : 'Admin billing mutation failed'
    throw new Error(message)
  }

  return payload
}
