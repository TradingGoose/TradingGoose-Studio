import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/auth-client'
import { useDebounce } from '@/hooks/use-debounce'

export const usernameInputProps = {
  required: true,
  minLength: 3,
  maxLength: 30,
  pattern: '[a-zA-Z0-9_.]+',
  autoComplete: 'username',
} as const

export function useUsernameAvailability(
  username: string,
  currentUsername?: string
): 'idle' | 'checking' | 'available' | 'taken' | 'error' {
  const candidate = username.trim().toLowerCase()
  const debounced = useDebounce(candidate, 300)
  const enabled = Boolean(candidate) && candidate !== currentUsername?.trim().toLowerCase()
  const query = useQuery({
    queryKey: ['username-availability', candidate],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.isUsernameAvailable({ username: candidate }, { signal })
      if (error) throw error
      return data.available
    },
    enabled: enabled && candidate === debounced,
    retry: false,
  })

  if (!enabled) return 'idle'
  if (candidate !== debounced || query.isPending || query.isFetching) return 'checking'
  if (query.isError) return 'error'
  return query.data ? 'available' : 'taken'
}
