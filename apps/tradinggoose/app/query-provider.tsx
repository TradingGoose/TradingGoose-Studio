'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let browserQueryClient: QueryClient | undefined

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
      },
    },
  })
}

export function getQueryClient() {
  if (typeof window === 'undefined') {
    return createQueryClient()
  }

  browserQueryClient ??= createQueryClient()
  return browserQueryClient
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getQueryClient)
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
