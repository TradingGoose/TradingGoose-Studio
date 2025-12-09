export interface CustomToolSchema {
  type: string
  function: {
    name: string
    description?: string
    parameters: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export interface CustomToolDefinition {
  id: string
  workspaceId: string
  userId: string | null
  title: string
  schema: CustomToolSchema
  code: string
  createdAt: string
  updatedAt?: string
}

export interface CustomToolsStore {
  toolsByWorkspace: Record<string, CustomToolDefinition[]>
  activeWorkspaceId: string | null

  setTools: (workspaceId: string, tools: CustomToolDefinition[]) => void
  getTool: (id: string, workspaceId?: string) => CustomToolDefinition | undefined
  getAllTools: (workspaceId?: string) => CustomToolDefinition[]
  resetWorkspace: (workspaceId: string) => void
  resetAll: () => void
}
