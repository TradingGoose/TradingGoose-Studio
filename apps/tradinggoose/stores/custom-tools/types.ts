export interface CustomToolSchema {
  type: string
  function: {
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
  createdAt?: string
  updatedAt?: string
}
