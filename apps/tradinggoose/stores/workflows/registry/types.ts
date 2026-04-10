export interface MarketplaceData {
  id: string // Marketplace entry ID to track original marketplace source
  status: 'owner' | 'temp'
}

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
  marketplaceData?: MarketplaceData | null
  workspaceId?: string
  folderId?: string | null
}

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
  removeWorkflow: (
    id: string,
    options?: { skipApi?: boolean; templateAction?: 'keep' | 'delete' }
  ) => Promise<void>
  updateWorkflow: (id: string, metadata: Partial<WorkflowMetadata>) => Promise<void>
  createWorkflow: (options?: {
    isInitial?: boolean
    marketplaceId?: string
    marketplaceState?: any
    name?: string
    description?: string
    color?: string
    workspaceId?: string
    folderId?: string | null
  }) => Promise<string>
  createMarketplaceWorkflow: (
    marketplaceId: string,
    state: any,
    metadata: Partial<WorkflowMetadata>
  ) => Promise<string>
  duplicateWorkflow: (sourceId: string) => Promise<string | null>
  getWorkflowDeploymentStatus: (workflowId: string | null) => DeploymentStatus | null
  setDeploymentStatus: (
    workflowId: string | null,
    isDeployed: boolean,
    deployedAt?: Date,
    apiKey?: string
  ) => void
  setWorkflowNeedsRedeployment: (workflowId: string | null, needsRedeployment: boolean) => void
}

export type WorkflowRegistry = WorkflowRegistryState & WorkflowRegistryActions
