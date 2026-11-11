'use client'

import { useQuery } from '@tanstack/react-query'

export interface CopilotModels {
  models: string[]
  defaultModel: string | null
}

export const copilotModelsKeys = {
  all: ['copilot-models'] as const,
}

export function useCopilotModels() {
  return useQuery({
    queryKey: copilotModelsKeys.all,
    queryFn: async (): Promise<CopilotModels> => {
      const response = await fetch('/api/copilot/models', { cache: 'no-store' })
      if (!response.ok) throw new Error('Copilot models could not be loaded')
      return response.json()
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}
