import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminBillingSettingsMutationInput } from '@/lib/admin/billing/settings-mutations'
import type { AdminBillingTierMutationInput } from '@/lib/admin/billing/tier-mutations'
import type { AdminBillingSnapshot } from '@/lib/admin/billing/types'
import { subscriptionKeys } from './subscription'

const ADMIN_BILLING_ENDPOINT = '/api/admin/billing'
const ADMIN_BILLING_SETTINGS_ENDPOINT = '/api/admin/billing/settings'
const ADMIN_BILLING_TIERS_ENDPOINT = '/api/admin/billing/tiers'

export const adminBillingKeys = {
  all: ['admin-billing'] as const,
  snapshot: () => [...adminBillingKeys.all, 'snapshot'] as const,
}

const ADMIN_SYSTEM_SETTINGS_SNAPSHOT_QUERY_KEY = ['admin-system-settings', 'snapshot'] as const

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

async function sendMutationRequest(
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

export function useCreateAdminBillingTier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AdminBillingTierMutationInput) =>
      sendMutationRequest(ADMIN_BILLING_TIERS_ENDPOINT, 'POST', input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminBillingKeys.snapshot() }),
        queryClient.invalidateQueries({
          queryKey: ADMIN_SYSTEM_SETTINGS_SNAPSHOT_QUERY_KEY,
        }),
      ])
    },
  })
}

export function useUpdateAdminBillingSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AdminBillingSettingsMutationInput) =>
      sendMutationRequest(ADMIN_BILLING_SETTINGS_ENDPOINT, 'PATCH', input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminBillingKeys.snapshot() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all }),
      ])
    },
  })
}

export function useUpdateAdminBillingTier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminBillingTierMutationInput }) =>
      sendMutationRequest(`${ADMIN_BILLING_TIERS_ENDPOINT}/${id}`, 'PATCH', input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminBillingKeys.snapshot() }),
        queryClient.invalidateQueries({
          queryKey: ADMIN_SYSTEM_SETTINGS_SNAPSHOT_QUERY_KEY,
        }),
      ])
    },
  })
}

export function useDeleteAdminBillingTier() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      sendMutationRequest(`${ADMIN_BILLING_TIERS_ENDPOINT}/${id}`, 'DELETE'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminBillingKeys.snapshot() }),
        queryClient.invalidateQueries({
          queryKey: ADMIN_SYSTEM_SETTINGS_SNAPSHOT_QUERY_KEY,
        }),
      ])
    },
  })
}
