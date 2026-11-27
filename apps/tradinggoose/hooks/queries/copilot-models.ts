'use client'

import { useQuery } from '@tanstack/react-query'
import type { CopilotModelOption } from '@/lib/copilot/settings'

export interface CopilotModels {
  models: CopilotModelOption[]
}

export const copilotModelsKeys = {
  all: ['copilot-models'] as const,
}

export function useCopilotModels() {
  return useQuery({
    queryKey: copilotModelsKeys.all,
    queryFn: async (): Promise<CopilotModels> => {
      const response = await fetch('/api/copilot/models', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json().catch(() => null)
      if (!Array.isArray(data?.models)) {
        throw new Error(`Invalid Copilot model response (HTTP ${response.status}).`)
      }
      return data
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}
