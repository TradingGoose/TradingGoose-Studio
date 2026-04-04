import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/validation', () => ({
  validateWorkflowState: (state: any) => ({
    valid: true,
    errors: [],
    warnings: [],
    sanitizedState: state,
  }),
}))

vi.mock('@/lib/workflows/json-sanitizer', () => ({
  sanitizeForCopilot: (state: any) => state,
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
}))

describe('editWorkflowServerTool', () => {
  it('does not persist canonical side effects while preparing a workflow edit proposal', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    const result = await editWorkflowServerTool.execute(
      {
        workflowId: 'wf-1',
        currentUserWorkflow: JSON.stringify({
          blocks: {
            'block-1': {
              id: 'block-1',
              type: 'trigger',
              name: 'Trigger',
              position: { x: 0, y: 0 },
              subBlocks: {},
              outputs: {},
              enabled: true,
            },
          },
          edges: [],
          loops: {},
          parallels: {},
        }),
        operations: [
          {
            operation_type: 'edit',
            block_id: 'block-1',
            params: { name: 'Edited Trigger' },
          },
        ],
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks['block-1'].name).toBe('Edited Trigger')
  })
})
