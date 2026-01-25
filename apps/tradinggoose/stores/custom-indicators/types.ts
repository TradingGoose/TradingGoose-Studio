export interface CustomIndicatorDefinition {
  id: string
  workspaceId: string
  userId: string | null
  name: string
  color?: string
  calcCode: string
  createdAt: string
  updatedAt?: string
}

export interface CustomIndicatorsStore {
  indicatorsByWorkspace: Record<string, CustomIndicatorDefinition[]>
  activeWorkspaceId: string | null

  setIndicators: (workspaceId: string, indicators: CustomIndicatorDefinition[]) => void
  getIndicator: (id: string, workspaceId?: string) => CustomIndicatorDefinition | undefined
  getAllIndicators: (workspaceId?: string) => CustomIndicatorDefinition[]
  resetWorkspace: (workspaceId: string) => void
  resetAll: () => void
}
