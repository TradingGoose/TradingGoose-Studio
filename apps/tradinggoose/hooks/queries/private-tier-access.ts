import { type FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  isPrivateTierAccessErrorCode,
  PRIVATE_TIER_ACCESS_ERROR_CODES,
  type PrivateTierAccessErrorCode,
} from '@/lib/billing/private-tier-access-contract'
import type { PublicBillingTierDisplay } from '@/lib/billing/public-catalog'

const PRIVATE_TIER_ACCESS_ENDPOINT = '/api/billing/private-tier-access'

export interface PrivateTierAccessResponse {
  privateTiers: PublicBillingTierDisplay[]
}

export const privateTierAccessKey = ['private-tier-access'] as const

export function getPrivateTierAccessErrorCode(error: unknown): PrivateTierAccessErrorCode | null {
  return error instanceof Error && isPrivateTierAccessErrorCode(error.message)
    ? error.message
    : null
}

async function assertResponseOk(response: Response, failureCode: PrivateTierAccessErrorCode) {
  if (response.ok) return

  const payload = await response.json().catch(() => null)
  const code = payload && isPrivateTierAccessErrorCode(payload.code) ? payload.code : failureCode
  throw new Error(code)
}

async function fetchPrivateTierAccess(signal: AbortSignal) {
  const response = await fetch(PRIVATE_TIER_ACCESS_ENDPOINT, { signal })
  await assertResponseOk(response, PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed)
  return response.json() as Promise<PrivateTierAccessResponse>
}

async function requestPrivateTierAccess(accessCode: string) {
  const response = await fetch(PRIVATE_TIER_ACCESS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessCode }),
  })
  return assertResponseOk(response, PRIVATE_TIER_ACCESS_ERROR_CODES.validateFailed)
}

export function usePrivateTierAccess() {
  return useQuery({
    queryKey: privateTierAccessKey,
    queryFn: ({ signal }) => fetchPrivateTierAccess(signal),
    staleTime: 30 * 1000,
  })
}

export function usePrivateTierAccessMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: requestPrivateTierAccess,
    onMutate: () => queryClient.cancelQueries({ queryKey: privateTierAccessKey }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: privateTierAccessKey }),
  })
}

export function usePrivateTierAccessForm() {
  const query = usePrivateTierAccess()
  const mutation = usePrivateTierAccessMutation()
  const [accessCode, setAccessCode] = useState('')
  const errorCode =
    getPrivateTierAccessErrorCode(mutation.error) ??
    (mutation.isError ? PRIVATE_TIER_ACCESS_ERROR_CODES.validateFailed : null) ??
    getPrivateTierAccessErrorCode(query.error) ??
    (query.isError ? PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed : null)

  function onChange(value: string) {
    mutation.reset()
    setAccessCode(value)
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate(accessCode.trim(), { onSuccess: () => setAccessCode('') })
  }

  return { accessCode, errorCode, mutation, onChange, onSubmit, query }
}
