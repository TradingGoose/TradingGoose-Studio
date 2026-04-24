export type {
  CostMetadata,
  LogsResponse,
  ProviderTiming,
  TokenInfo,
  ToolCall,
  TraceSpan,
  WorkflowLog,
  WorkflowLogOutcome,
  WorkflowLogWorkflowSummary as WorkflowData,
} from '@/lib/logs/types'

export type TimeRange =
  | 'Past 30 minutes'
  | 'Past hour'
  | 'Past 6 hours'
  | 'Past 12 hours'
  | 'Past 24 hours'
  | 'Past 3 days'
  | 'Past 7 days'
  | 'Past 14 days'
  | 'Past 30 days'
  | 'All time'

export type LogLevel = 'error' | 'info' | 'all'
export type TriggerType = 'chat' | 'api' | 'webhook' | 'manual' | 'schedule' | 'all'

export interface FilterState {
  logs: import('@/lib/logs/types').WorkflowLog[]
  workspaceId: string
  viewMode: 'logs' | 'dashboard'
  timeRange: TimeRange
  level: LogLevel
  workflowIds: string[]
  folderIds: string[]
  searchQuery: string
  triggers: TriggerType[]
  loading: boolean
  error: string | null
  page: number
  hasMore: boolean
  isFetchingMore: boolean
  _isInitializing: boolean
  setLogs: (logs: import('@/lib/logs/types').WorkflowLog[], append?: boolean) => void
  setWorkspaceId: (workspaceId: string) => void
  setViewMode: (viewMode: 'logs' | 'dashboard') => void
  setTimeRange: (timeRange: TimeRange) => void
  setLevel: (level: LogLevel) => void
  setWorkflowIds: (workflowIds: string[]) => void
  toggleWorkflowId: (workflowId: string) => void
  setFolderIds: (folderIds: string[]) => void
  toggleFolderId: (folderId: string) => void
  setSearchQuery: (query: string) => void
  setTriggers: (triggers: TriggerType[]) => void
  toggleTrigger: (trigger: TriggerType) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setPage: (page: number) => void
  setHasMore: (hasMore: boolean) => void
  setIsFetchingMore: (isFetchingMore: boolean) => void
  resetPagination: () => void
  initializeFromURL: () => void
  syncWithURL: () => void
  buildQueryParams: (page: number, limit: number) => string
}
