import type { Edge } from '@xyflow/react'
import type { BlockLog, NormalizedBlockOutput } from '@/executor/types'
import type { DeploymentStatus } from '@/stores/workflows/registry/types'
import type { Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

export type { WorkflowState, Loop, Parallel, DeploymentStatus }
export type WorkflowEdge = Edge
export type { NormalizedBlockOutput, BlockLog }

export interface ToolCall {
  id?: string
  name: string
  duration: number
  startTime: string
  endTime: string
  status: 'success' | 'error'
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
}

export interface ToolCallMetadata {
  toolCalls?: ToolCall[]
}

export interface CostMetadata {
  baseExecutionCharge?: number
  models?: Record<
    string,
    {
      input?: number
      output?: number
      total?: number
      tokens?: {
        prompt?: number
        completion?: number
        total?: number
      }
    }
  >
  input?: number
  output?: number
  total?: number
  tokens?: {
    prompt?: number
    completion?: number
    total?: number
  }
  pricing?: {
    input: number
    output: number
    cachedInput?: number
    updatedAt: string
  }
}

export type BlockInputData = Record<string, any>
export type BlockOutputData = NormalizedBlockOutput | null

export interface ExecutionEnvironment {
  variables: Record<string, string>
  workflowId: string
  executionId: string
  userId: string
  workspaceId: string
}

export interface ExecutionTrigger {
  type: 'api' | 'webhook' | 'schedule' | 'manual' | 'chat'
  source: string
  data?: Record<string, unknown>
  timestamp: string
}

export interface WorkflowExecutionSnapshot {
  id: string
  workflowId: string | null
  workspaceId: string
  stateHash: string
  stateData: WorkflowState
  createdAt?: string
}

export type WorkflowExecutionSnapshotInsert = Omit<WorkflowExecutionSnapshot, 'createdAt'>
export type WorkflowExecutionSnapshotSelect = WorkflowExecutionSnapshot

export interface WorkflowExecutionLog {
  id: string
  workflowId: string | null
  workspaceId: string
  executionId: string
  stateSnapshotId: string
  workflowSummary: WorkflowLogWorkflowSummary
  level: 'info' | 'error'
  trigger: ExecutionTrigger['type']
  startedAt: string
  endedAt: string
  totalDurationMs: number
  files?: Array<{
    id: string
    name: string
    size: number
    type: string
    url: string
    key: string
    uploadedAt: string
    expiresAt: string
    storageProvider?: 's3' | 'azure' | 'vercel' | 'local'
    bucketName?: string
  }>
  // Execution details
  executionData: {
    environment?: ExecutionEnvironment
    trigger?: ExecutionTrigger
    traceSpans?: TraceSpan[]
    errorMessage?: string
    finalOutput?: unknown
  }
  // Top-level cost information
  cost?: {
    input?: number
    output?: number
    total?: number
    tokens?: { prompt?: number; completion?: number; total?: number }
    models?: Record<
      string,
      {
        input?: number
        output?: number
        total?: number
        tokens?: { prompt?: number; completion?: number; total?: number }
      }
    >
  }
  durationMs?: number | null
  createdAt?: string
}

export type WorkflowExecutionLogInsert = Omit<WorkflowExecutionLog, 'id' | 'createdAt'>
export type WorkflowExecutionLogSelect = WorkflowExecutionLog

export interface TokenInfo {
  input?: number
  output?: number
  total?: number
  prompt?: number
  completion?: number
}

export interface ProviderTiming {
  duration: number
  startTime: string
  endTime: string
  segments: Array<{
    type: string
    name?: string
    startTime: string | number
    endTime: string | number
    duration: number
  }>
}

export interface TraceSpan {
  id: string
  name: string
  type: string
  duration: number
  startTime: string
  endTime: string
  children?: TraceSpan[]
  toolCalls?: ToolCall[]
  status?: 'success' | 'error'
  tokens?: number | TokenInfo
  relativeStartMs?: number
  blockId?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  model?: string
  cost?: {
    input?: number
    output?: number
    total?: number
  }
  providerTiming?: ProviderTiming
}

export type WorkflowLogOutcome = 'running' | 'success' | 'error'

export interface WorkflowLogWorkflowSummary {
  id: string
  name: string
  description: string | null
  color: string
  state?: unknown
  folderId?: string | null
  folderName?: string | null
  userId?: string
  workspaceId?: string
  createdAt?: string
  updatedAt?: string
}

export interface WorkflowLog {
  id: string
  workflowId: string | null
  workspaceId?: string
  executionId: string | null
  level: string
  trigger: string | null
  startedAt?: string
  createdAt: string
  recordCreatedAt?: string
  endedAt?: string | null
  durationMs?: number | null
  duration?: string | null
  outcome?: WorkflowLogOutcome
  workflow?: WorkflowLogWorkflowSummary | null
  files?: Array<{
    id: string
    name: string
    size: number
    type: string
    url: string
    key: string
    uploadedAt: string
    expiresAt: string
    storageProvider?: 's3' | 'azure' | 'vercel' | 'local'
    bucketName?: string
  }>
  cost?: CostMetadata
  executionData?: ToolCallMetadata & {
    errorMessage?: string
    finalOutput?: unknown
    traceSpans?: TraceSpan[]
    blockInput?: Record<string, unknown>
  }
}

export interface LogsResponse {
  data: WorkflowLog[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface LogsError {
  code: 'EXECUTION_NOT_FOUND' | 'SNAPSHOT_NOT_FOUND' | 'INVALID_WORKFLOW_STATE' | 'STORAGE_ERROR'
  message: string
  details?: Record<string, unknown>
}

export interface ValidationError {
  field: string
  message: string
  value: unknown
}

export class LogsServiceError extends Error {
  public code: LogsError['code']
  public details?: Record<string, unknown>

  constructor(message: string, code: LogsError['code'], details?: Record<string, unknown>) {
    super(message)
    this.name = 'LogsServiceError'
    this.code = code
    this.details = details
  }
}

export interface DatabaseOperationResult<T> {
  success: boolean
  data?: T
  error?: LogsServiceError
}

export interface BatchInsertResult<T> {
  inserted: T[]
  failed: Array<{
    item: T
    error: string
  }>
  totalAttempted: number
  totalSucceeded: number
  totalFailed: number
}

export interface SnapshotService {
  createSnapshot(params: {
    workflowId: string
    workspaceId: string
    state: WorkflowState
  }): Promise<WorkflowExecutionSnapshot>
  getSnapshot(id: string): Promise<WorkflowExecutionSnapshot | null>
  getSnapshotByHash(params: {
    workflowId: string
    workspaceId: string
    hash: string
  }): Promise<WorkflowExecutionSnapshot | null>
  computeStateHash(state: WorkflowState): string
  cleanupOrphanedSnapshots(olderThanDays: number): Promise<number>
}

export interface SnapshotCreationResult {
  snapshot: WorkflowExecutionSnapshot
  isNew: boolean
}
