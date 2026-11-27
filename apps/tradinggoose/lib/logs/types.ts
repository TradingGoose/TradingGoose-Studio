import type { Edge } from '@xyflow/react'
import type { InferenceFacts } from '@/lib/mastra/result'
import type { NativeCost } from '@/lib/mastra/usage'
import type { BlockLog, NormalizedBlockOutput } from '@/executor/types'
import type { DeploymentStatus } from '@/stores/workflows/registry/types'
import type { Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

export type { WorkflowState, Loop, Parallel, DeploymentStatus }
export type WorkflowEdge = Edge
export type { NormalizedBlockOutput, BlockLog }

export interface CostMetadata extends NativeCost {
  unavailableComponents?: number
  modelCost?: number
  models?: Record<
    string,
    {
      input?: number
      output?: number
      total?: number
      availableTotal?: number
      status?: NativeCost['status']
      tokens?: {
        prompt?: number
        completion?: number
        total?: number
      }
    }
  >
  tokens?: {
    prompt?: number
    completion?: number
    total?: number
  }
}

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
  cost?: CostMetadata
  durationMs?: number | null
  createdAt?: string
}

export interface TraceSpan {
  inference?: InferenceFacts
  agentHistory?: import('@/lib/mastra/messages').NativeHistoryMessage[]
  id: string
  name: string
  type: string
  duration: number
  startTime: string
  endTime: string
  children?: TraceSpan[]
  status?: 'success' | 'error'
  tokens?: InferenceFacts['tokens']
  relativeStartMs?: number
  blockId?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  model?: string
  cost?: NativeCost
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
  files?: WorkflowExecutionLog['files']
  cost?: CostMetadata
  executionData?: {
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

export interface SnapshotCreationResult {
  snapshot: WorkflowExecutionSnapshot
  isNew: boolean
}
