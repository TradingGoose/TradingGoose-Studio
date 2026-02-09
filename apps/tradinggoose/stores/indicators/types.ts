import type { InputMetaMap } from '@/lib/indicators/types'

export interface IndicatorDefinition {
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

export interface IndicatorsStore {
  indicatorsByWorkspace: Record<string, IndicatorDefinition[]>
  activeWorkspaceId: string | null

  setIndicators: (workspaceId: string, indicators: IndicatorDefinition[]) => void
  getIndicator: (id: string, workspaceId?: string) => IndicatorDefinition | undefined
  getAllIndicators: (workspaceId?: string) => IndicatorDefinition[]
  resetWorkspace: (workspaceId: string) => void
  resetAll: () => void
}
