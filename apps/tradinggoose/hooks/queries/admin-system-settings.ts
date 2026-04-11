import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminSystemSettingsMutationInput } from '@/lib/admin/system-settings/mutations'
import type { AdminSystemSettingsSnapshot } from '@/lib/admin/system-settings/types'
import { adminBillingKeys } from './admin-billing'
import { adminRegistrationKeys } from './admin-registration'

const ADMIN_SYSTEM_SETTINGS_ENDPOINT = '/api/admin/system-settings'

export const adminSystemSettingsKeys = {
  all: ['admin-system-settings'] as const,
  snapshot: () => [...adminSystemSettingsKeys.all, 'snapshot'] as const,
}

async function parseResponse(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

function normalizeSnapshot(payload: unknown): AdminSystemSettingsSnapshot {
  if (!payload || typeof payload !== 'object') {
    return {
      registrationMode: 'open',
      billingEnabled: false,
      billingReady: false,
      allowPromotionCodes: true,
      stripeSecretKey: '',
      stripeWebhookSecret: '',
    }
  }

  const data = payload as Record<string, unknown>

  return {
    registrationMode:
      data.registrationMode === 'disabled' ||
      data.registrationMode === 'waitlist' ||
      data.registrationMode === 'open'
        ? data.registrationMode
        : 'open',
    billingEnabled: typeof data.billingEnabled === 'boolean' ? data.billingEnabled : false,
    billingReady: typeof data.billingReady === 'boolean' ? data.billingReady : false,
    allowPromotionCodes:
      typeof data.allowPromotionCodes === 'boolean' ? data.allowPromotionCodes : true,
    stripeSecretKey: typeof data.stripeSecretKey === 'string' ? data.stripeSecretKey : '',
    stripeWebhookSecret:
      typeof data.stripeWebhookSecret === 'string' ? data.stripeWebhookSecret : '',
  }
}

async function fetchAdminSystemSettingsSnapshot(): Promise<AdminSystemSettingsSnapshot> {
  const response = await fetch(ADMIN_SYSTEM_SETTINGS_ENDPOINT, {
    cache: 'no-store',
  })

  const payload = await parseResponse(response)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : 'Failed to load system settings'
    throw new Error(message)
  }

  return normalizeSnapshot(payload)
}

export function useAdminSystemSettingsSnapshot() {
  return useQuery({
    queryKey: adminSystemSettingsKeys.snapshot(),
    queryFn: fetchAdminSystemSettingsSnapshot,
    staleTime: 30 * 1000,
  })
}

export function useUpdateAdminSystemSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: AdminSystemSettingsMutationInput
    ): Promise<AdminSystemSettingsSnapshot> => {
      const response = await fetch(ADMIN_SYSTEM_SETTINGS_ENDPOINT, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      })

      const payload = await parseResponse(response)
      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String(payload.error)
            : 'Failed to update system settings'
        throw new Error(message)
      }

      return normalizeSnapshot(payload)
    },
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(adminSystemSettingsKeys.snapshot(), snapshot)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminBillingKeys.snapshot() }),
        queryClient.invalidateQueries({ queryKey: adminRegistrationKeys.snapshot() }),
      ])
    },
  })
}
