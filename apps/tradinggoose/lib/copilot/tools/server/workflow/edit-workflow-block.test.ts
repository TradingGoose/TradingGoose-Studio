import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/validation', () => ({
  validateWorkflowState: (state: any) => ({
    valid: true,
    errors: [],
    warnings: [],
    sanitizedState: state,
  }),
}))

vi.mock('@/lib/workflows/db-helpers', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
}))

const CURRENT_WORKFLOW_STATE = JSON.stringify({
  direction: 'TD',
  blocks: {
    fn1: {
      id: 'fn1',
      type: 'function',
      name: 'Compute Indicators',
      position: { x: 0, y: 0 },
      enabled: true,
      subBlocks: {
        code: {
          id: 'code',
          type: 'code',
          value: 'return { ok: true }',
        },
      },
      outputs: {},
    },
  },
  edges: [],
  loops: {},
  parallels: {},
})

describe('editWorkflowBlockServerTool', () => {
  it('patches only the selected block config and preserves the workflow document envelope', async () => {
    const { editWorkflowBlockServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow-block'
    )

    const result = await editWorkflowBlockServerTool.execute(
      {
        workflowId: 'wf-1',
        blockId: 'fn1',
        blockType: 'function',
        name: 'Compute Market Indicators',
        subBlocks: {
          code: 'return { rsi: 50 }',
        },
        currentWorkflowState: CURRENT_WORKFLOW_STATE,
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks.fn1.name).toBe('Compute Market Indicators')
    expect(result.workflowState.blocks.fn1.subBlocks.code.value).toBe('return { rsi: 50 }')
    expect(result.workflowState.edges).toEqual([])
    expect(result.workflowDocument).toContain('Compute Market Indicators')
    expect(result.entityDocument).toBe(result.workflowDocument)
  })

  it('rejects non-canonical sub-block ids with structured issues', async () => {
    const { editWorkflowBlockServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow-block'
    )

    await expect(
      editWorkflowBlockServerTool.execute(
        {
          workflowId: 'wf-1',
          blockId: 'fn1',
          blockType: 'function',
          subBlocks: {
            madeUpField: 'bad',
          },
          currentWorkflowState: CURRENT_WORKFLOW_STATE,
        },
        { userId: 'user-1' }
      )
    ).rejects.toMatchObject({
      code: 'invalid_workflow_block_edit',
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: 'subBlocks.madeUpField',
        }),
      ]),
    })
  })
})
