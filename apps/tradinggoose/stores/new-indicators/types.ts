import type { InputMetaMap } from '@/lib/new_indicators/types'

export interface NewIndicatorDefinition {
  id: string
  workspaceId: string
  userId: string | null
  name: string
  color?: string
  pineCode: string
  inputMeta?: InputMetaMap | null
  createdAt: string
  updatedAt?: string
}

export interface NewIndicatorsStore {
  indicatorsByWorkspace: Record<string, NewIndicatorDefinition[]>
  activeWorkspaceId: string | null

  setIndicators: (workspaceId: string, indicators: NewIndicatorDefinition[]) => void
  getIndicator: (id: string, workspaceId?: string) => NewIndicatorDefinition | undefined
  getAllIndicators: (workspaceId?: string) => NewIndicatorDefinition[]
  resetWorkspace: (workspaceId: string) => void
  resetAll: () => void
}
