import { describe, expect, it } from 'vitest'
import { createWorkflowExecutionResultFromLog } from './workflow-execution-events'

describe('createWorkflowExecutionResultFromLog', () => {
  it('reconstructs the canonical deadline failure from the durable workflow log', () => {
    const error =
      'Workflow execution stopped because it reached the 20-second Workflow Execution Time Limit for the "Pro" tier.'
    const result = createWorkflowExecutionResultFromLog({
      level: 'error',
      startedAt: new Date('2026-08-07T15:16:14.000Z'),
      endedAt: new Date('2026-08-07T15:16:34.000Z'),
      totalDurationMs: 20_000,
      executionData: {
        errorMessage: error,
        finalOutput: {},
        result: {
          success: false,
          output: {},
          error,
          logs: [],
          code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
          deadline: {
            appliedTierId: 'tier-pro',
            appliedTierName: 'Pro',
            limitSeconds: 20,
            processingStartedAt: '2026-08-07T15:16:14.000Z',
            terminatedAt: '2026-08-07T15:16:34.000Z',
          },
        },
      },
    })

    expect(result).toMatchObject({
      status: 'failed',
      failureReason: error,
      result: {
        success: false,
        error,
        code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
        deadline: {
          appliedTierName: 'Pro',
          limitSeconds: 20,
        },
      },
    })
  })
})
