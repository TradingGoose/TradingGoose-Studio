import { describe, expect, it } from 'vitest'
import { createInternalWorkflowJobResult, createPublicExecutionResult } from './execution-result'

const result = {
  success: false,
  output: {},
  error: 'Workflow execution time limit exceeded',
  code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED' as const,
  deadline: {
    appliedTierId: 'tier-1',
    appliedTierName: 'Pro',
    limitSeconds: 60,
    processingStartedAt: '2026-01-01T00:00:00.000Z',
    terminatedAt: '2026-01-01T00:01:00.000Z',
  },
  remainingMilliseconds: 0,
}

describe('workflow execution result projections', () => {
  it('keeps remaining budget private to internal child polling', () => {
    expect(createPublicExecutionResult(result)).not.toHaveProperty('remainingMilliseconds')
    expect(createInternalWorkflowJobResult(result)).toMatchObject({ remainingMilliseconds: 0 })
  })
})
