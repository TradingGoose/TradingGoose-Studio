import { useQuery } from '@tanstack/react-query'
import { DEFAULT_REGISTRATION_MODE, type RegistrationMode } from '@/lib/registration/shared'

const REGISTRATION_ENDPOINT = '/api/registration'

export const registrationKeys = {
  all: ['registration'] as const,
  state: () => [...registrationKeys.all, 'state'] as const,
}

interface RegistrationResponse {
  registrationMode: RegistrationMode
}

async function fetchRegistrationState(): Promise<RegistrationResponse> {
  const response = await fetch(REGISTRATION_ENDPOINT, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Failed to load registration state')
  }

  const payload = (await response.json()) as Partial<RegistrationResponse>
  return {
    registrationMode: payload.registrationMode ?? DEFAULT_REGISTRATION_MODE,
  }
}

export function useRegistrationState(enabled = true) {
  return useQuery({
    queryKey: registrationKeys.state(),
    queryFn: fetchRegistrationState,
    enabled,
    staleTime: 30 * 1000,
  })
}
