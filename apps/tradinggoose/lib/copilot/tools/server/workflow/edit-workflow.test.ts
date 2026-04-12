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

describe('editWorkflowServerTool', () => {
  it(
    'does not persist canonical side effects while preparing a workflow edit proposal',
    { timeout: 10_000 },
    async () => {
      const { editWorkflowServerTool } = await import(
        '@/lib/copilot/tools/server/workflow/edit-workflow'
      )

      const result = await editWorkflowServerTool.execute(
        {
          workflowId: 'wf-1',
          workflowDocument: [
            'flowchart TD',
            '%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
            '%% TG_BLOCK {"id":"block-1","type":"input_trigger","name":"Edited Trigger","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}',
          ].join('\n'),
          currentWorkflowState: JSON.stringify({
            blocks: {
              'block-1': {
                id: 'block-1',
                type: 'input_trigger',
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
        },
        { userId: 'user-1' }
      )

      expect(result.workflowState.blocks['block-1'].name).toBe('Edited Trigger')
      expect(result.documentFormat).toBe('tg-mermaid-v1')
      expect(result.workflowDocument).toContain('TG_BLOCK')
    }
  )
})
