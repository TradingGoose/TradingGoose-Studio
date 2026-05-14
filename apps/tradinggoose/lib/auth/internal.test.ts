import { afterEach, describe, expect, it, vi } from 'vitest'

const originalInternalSecret = process.env.INTERNAL_API_SECRET

afterEach(() => {
  if (originalInternalSecret === undefined) {
    delete process.env.INTERNAL_API_SECRET
  } else {
    process.env.INTERNAL_API_SECRET = originalInternalSecret
  }
  vi.resetModules()
})

describe('internal auth tokens', () => {
  it('signs and verifies child workflow execution context', async () => {
    process.env.INTERNAL_API_SECRET = '12345678901234567890123456789012'
    vi.resetModules()

    const { generateInternalToken, verifyInternalTokenDetailed } = await import('./internal')
    const token = await generateInternalToken('user-1', {
      workflowExecution: {
        source: 'workflow_block',
        parentWorkflowId: 'parent-workflow-1',
        parentExecutionId: 'parent-execution-1',
        parentBlockId: 'workflow-block-1',
      },
    })

    await expect(verifyInternalTokenDetailed(token)).resolves.toMatchObject({
      valid: true,
      userId: 'user-1',
      workflowExecution: {
        source: 'workflow_block',
        parentWorkflowId: 'parent-workflow-1',
        parentExecutionId: 'parent-execution-1',
        parentBlockId: 'workflow-block-1',
      },
    })
  })
})
