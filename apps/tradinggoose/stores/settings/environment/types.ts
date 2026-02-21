export interface EnvironmentVariable {
  key: string
  value: string
}

export interface EnvironmentState {
  variables: Record<string, EnvironmentVariable>
  isLoading: boolean
  error: string | null
}

export interface EnvironmentStore extends EnvironmentState {
  loadEnvironmentVariables: () => Promise<void>
  setVariables: (variables: Record<string, EnvironmentVariable>) => void
  saveEnvironmentVariables: (variables: Record<string, string>) => Promise<void>

  loadWorkspaceEnvironment: (workspaceId: string) => Promise<{
    workspace: Record<string, string>
    personal: Record<string, string>
    conflicts: string[]
    workspaceRows?: Array<{
      key: string
      value: string
      createdAt?: string | null
      updatedAt?: string | null
    }>
    personalRows?: Array<{
      key: string
      value: string
      createdAt?: string | null
      updatedAt?: string | null
    }>
  }>
  upsertWorkspaceEnvironment: (
    workspaceId: string,
    variables: Record<string, string>
  ) => Promise<void>
  removeWorkspaceEnvironmentKeys: (workspaceId: string, keys: string[]) => Promise<void>

  getAllVariables: () => Record<string, EnvironmentVariable>
}
