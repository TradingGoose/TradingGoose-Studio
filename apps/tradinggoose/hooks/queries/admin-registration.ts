import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminRegistrationSnapshot } from '@/lib/admin/registration/types'
import {
  DEFAULT_REGISTRATION_MODE,
  type RegistrationMode,
  type WaitlistStatus,
} from '@/lib/registration/shared'

const ADMIN_REGISTRATION_ENDPOINT = '/api/admin/registration'

export const adminRegistrationKeys = {
  all: ['admin-registration'] as const,
  snapshot: () => [...adminRegistrationKeys.all, 'snapshot'] as const,
}

function normalizeSnapshot(payload: unknown): AdminRegistrationSnapshot {
  if (!payload || typeof payload !== 'object') {
    return { registrationMode: DEFAULT_REGISTRATION_MODE, waitlist: [] }
  }

  const data = payload as Record<string, unknown>
  const registrationMode =
    data.registrationMode === 'disabled' ||
    data.registrationMode === 'waitlist' ||
    data.registrationMode === 'open'
      ? data.registrationMode
      : DEFAULT_REGISTRATION_MODE

  return {
    registrationMode,
    waitlist: Array.isArray(data.waitlist)
      ? data.waitlist.map((entry) => {
          const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}

          return {
            id: typeof item.id === 'string' ? item.id : '',
            email: typeof item.email === 'string' ? item.email : '',
            status:
              item.status === 'pending' ||
              item.status === 'approved' ||
              item.status === 'rejected' ||
              item.status === 'signed_up'
                ? item.status
                : ('pending' as WaitlistStatus),
            approvedAt: typeof item.approvedAt === 'string' ? item.approvedAt : null,
            approvedByUserId: typeof item.approvedByUserId === 'string' ? item.approvedByUserId : null,
            rejectedAt: typeof item.rejectedAt === 'string' ? item.rejectedAt : null,
            rejectedByUserId: typeof item.rejectedByUserId === 'string' ? item.rejectedByUserId : null,
            signedUpAt: typeof item.signedUpAt === 'string' ? item.signedUpAt : null,
            userId: typeof item.userId === 'string' ? item.userId : null,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
          }
        })
      : [],
  }
}

async function parseResponse(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function fetchAdminRegistrationSnapshot(): Promise<AdminRegistrationSnapshot> {
  const response = await fetch(ADMIN_REGISTRATION_ENDPOINT, {
    cache: 'no-store',
  })

  const payload = await parseResponse(response)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : 'Failed to load admin registration'
    throw new Error(message)
  }

  return normalizeSnapshot(payload)
}

export function useAdminRegistrationSnapshot() {
  return useQuery({
    queryKey: adminRegistrationKeys.snapshot(),
    queryFn: fetchAdminRegistrationSnapshot,
    staleTime: 30 * 1000,
  })
}

export function useSaveRegistrationMode() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (registrationMode: RegistrationMode) => {
      const response = await fetch(ADMIN_REGISTRATION_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'settings',
          registrationMode,
        }),
      })

      const payload = await parseResponse(response)
      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String(payload.error)
            : 'Failed to update registration mode'
        throw new Error(message)
      }

      return normalizeSnapshot(payload)
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(adminRegistrationKeys.snapshot(), snapshot)
    },
  })
}

export function useUpdateWaitlistStatuses() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      ids: string[]
      status: Extract<WaitlistStatus, 'approved' | 'rejected'>
    }) => {
      const response = await fetch(ADMIN_REGISTRATION_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'waitlist',
          ids,
          status,
        }),
      })

      const payload = await parseResponse(response)
      if (!response.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload
            ? String(payload.error)
            : 'Failed to update waitlist entry'
        throw new Error(message)
      }

      return normalizeSnapshot(payload)
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(adminRegistrationKeys.snapshot(), snapshot)
    },
  })
}
