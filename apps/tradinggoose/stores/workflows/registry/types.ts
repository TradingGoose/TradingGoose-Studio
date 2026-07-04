export interface DeploymentStatus {
  isDeployed: boolean
  deployedAt?: Date
  apiKey?: string
  needsRedeployment?: boolean
}

export interface WorkflowMetadata {
  id: string
  name: string
  lastModified: Date
  createdAt: Date
  description?: string
  color: string
  workspaceId?: string
  folderId?: string | null
}

export type WorkflowMetadataSeed = Pick<
  WorkflowMetadata,
  'id' | 'name' | 'description' | 'color' | 'workspaceId' | 'folderId'
> &
  Partial<Pick<WorkflowMetadata, 'lastModified' | 'createdAt'>>

export type HydrationPhase =
  | 'idle'
  | 'metadata-loading'
  | 'metadata-ready'
  | 'state-loading'
  | 'ready'
  | 'error'

export interface ChannelHydrationState {
  phase: HydrationPhase
  workspaceId: string | null
  workflowId: string | null
  requestId: string | null
  error: string | null
}

export const WORKSPACE_BOOTSTRAP_CHANNEL = '__workspace__'

export interface WorkflowRegistryState {
  workflows: Record<string, WorkflowMetadata>
  activeWorkflowIds: Record<string, string>
  loadedWorkflowIds: Record<string, boolean>
  hydrationByChannel: Record<string, ChannelHydrationState>
  isLoading: boolean
  error: string | null
  deploymentStatuses: Record<string, DeploymentStatus>
}

export interface WorkflowRegistryActions {
  getActiveWorkflowId: (channelId?: string) => string | null
  getHydration: (channelId?: string) => ChannelHydrationState
  isChannelHydrating: (channelId?: string) => boolean
  getLoadedChannelsForWorkflow: (workflowId: string) => string[]
  getPrimaryLoadedChannelForWorkflow: (workflowId: string) => string | null
  setActiveWorkflow: (params: { workflowId: string; channelId?: string }) => Promise<void>
  switchToWorkspace: (id: string) => Promise<void>
  loadWorkflows: (params: { workspaceId: string; channelId?: string }) => Promise<void>
  removeWorkflow: (id: string, options?: { skipApi?: boolean }) => Promise<void>
  updateWorkflow: (
    id: string,
    metadata: Partial<Pick<WorkflowMetadata, 'name' | 'description' | 'folderId'>>,
    source?: WorkflowMetadataSeed
  ) => Promise<void>
  createWorkflow: (options?: {
    isInitial?: boolean
    name?: string
    description?: string
    workspaceId?: string
    folderId?: string | null
    initialWorkflowState?: any
  }) => Promise<string>
  duplicateWorkflow: (sourceId: string, source?: WorkflowMetadataSeed) => Promise<string | null>
  readWorkflowDeploymentStatus: (workflowId: string | null) => DeploymentStatus | null
  setDeploymentStatus: (
    workflowId: string | null,
    isDeployed: boolean,
    deployedAt?: Date,
    apiKey?: string
  ) => void
  setWorkflowNeedsRedeployment: (workflowId: string | null, needsRedeployment: boolean) => void
}

export type WorkflowRegistry = WorkflowRegistryState & WorkflowRegistryActions
