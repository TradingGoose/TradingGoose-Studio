import type { WorkflowExecutionBlueprint } from '@/lib/workflows/execution-runner'
import type { workflowPauseLinks } from '@/lib/workflows/human-in-the-loop/links'
import type { WorkflowFieldType } from '@/lib/workflows/value-types'
import type { ExecutorCheckpoint } from '@/executor/checkpoint'
import type { TriggerType } from '@/services/queue'

export interface WorkflowPauseInputField {
  name: string
  type: WorkflowFieldType
  required?: boolean
  description?: string
  value?: unknown
}

export interface WorkflowPauseNotification {
  toolId: string
  params?: Record<string, unknown>
}

export interface WorkflowPausePoint {
  id: string
  blockId: string
  blockName: string
  kind: 'human' | 'child'
  displayData: Record<string, unknown>
  inputFormat: WorkflowPauseInputField[]
  notification?: WorkflowPauseNotification[]
  childExecutionId?: string
  childWorkflowId?: string
  childWorkflowName?: string
  input?: Record<string, unknown>
  reviewerId?: string
}

export interface WorkflowCheckpointSnapshot {
  executor: ExecutorCheckpoint
  blueprint: WorkflowExecutionBlueprint
  workflowInput: unknown
  triggerType: TriggerType
  triggerData?: Record<string, unknown>
  workflowLogId: string
  encryptedEnvVars?: Record<string, string>
}

/** Internal state on the existing execution log; excluded from public log projections. */
export interface StoredWorkflowCheckpoint {
  revision: number
  encryptedSnapshot: string
  pausePoints: WorkflowPausePoint[]
  activeJobId: string | null
}

export type WorkflowCheckpointLogData = Record<string, unknown> & {
  checkpoint?: StoredWorkflowCheckpoint
  pause?: ReturnType<typeof workflowPauseLinks> & { revision: number }
  environment?: { userId?: string; [key: string]: unknown }
  finalOutput?: Record<string, unknown>
}

export type WorkflowCheckpointStatus =
  | 'paused'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface WorkflowCheckpointView {
  executionId: string
  workflowId: string
  revision: number
  status: WorkflowCheckpointStatus
  pausePoints: Array<Omit<WorkflowPausePoint, 'notification' | 'reviewerId'>>
}

export const workflowResumeJobId = (executionId: string, revision: number) =>
  `${executionId}:resume:${revision}`
