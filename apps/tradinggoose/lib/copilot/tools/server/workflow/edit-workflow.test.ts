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

      expect(result.entityKind).toBe('workflow')
      expect(result.entityId).toBe('wf-1')
      expect(result.entityDocument).toBe(result.workflowDocument)
      expect(result.workflowState.blocks['block-1'].name).toBe('Edited Trigger')
      expect(result.documentFormat).toBe('tg-mermaid-v1')
      expect(result.workflowDocument).toContain('TG_BLOCK')
    }
  )

  it('rejects non-canonical TG_BLOCK metadata aliases', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    await expect(
      editWorkflowServerTool.execute(
        {
          workflowId: 'wf-1',
          workflowDocument: [
            'flowchart TD',
            '%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
            '%% TG_BLOCK {"id":"block-1","blockType":"input_trigger","blockName":"Edited Trigger","blockDescription":"ignored","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}',
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
    ).rejects.toThrow(
      'Invalid TG_BLOCK payload: expected object with string id and string type. Workflow documents use `type`, not `blockType`.'
    )
  })

  it('re-lays out staged workflow state to match LR Mermaid direction before review', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    const result = await editWorkflowServerTool.execute(
      {
        workflowId: 'wf-1',
        workflowDocument: [
          'flowchart LR',
          '%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"LR"}',
          'inputTrigger(["Input Trigger"])',
          '%% TG_BLOCK {"id":"inputTrigger","type":"input_trigger","name":"Input Trigger","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}',
          'agentBlock(["Agent"])',
          '%% TG_BLOCK {"id":"agentBlock","type":"agent","name":"Agent","position":{"x":0,"y":280},"subBlocks":{},"outputs":{},"enabled":true}',
          'inputTrigger --> agentBlock',
          '%% TG_EDGE {"source":"inputTrigger","target":"agentBlock"}',
        ].join('\n'),
        currentWorkflowState: JSON.stringify({
          direction: 'TD',
          blocks: {
            inputTrigger: {
              id: 'inputTrigger',
              type: 'input_trigger',
              name: 'Input Trigger',
              position: { x: 0, y: 0 },
              subBlocks: {},
              outputs: {},
              enabled: true,
            },
            agentBlock: {
              id: 'agentBlock',
              type: 'agent',
              name: 'Agent',
              position: { x: 0, y: 280 },
              subBlocks: {},
              outputs: {},
              enabled: true,
            },
          },
          edges: [
            {
              id: 'inputTrigger-source-agentBlock-target',
              source: 'inputTrigger',
              target: 'agentBlock',
            },
          ],
          loops: {},
          parallels: {},
        }),
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.direction).toBe('LR')
    expect(result.entityDocument).toBe(result.workflowDocument)
    expect(result.workflowState.blocks.agentBlock.position.x).toBeGreaterThan(
      result.workflowState.blocks.inputTrigger.position.x
    )
    expect(result.workflowDocument).toContain('flowchart LR')
    expect(result.preview.warnings).toContain(
      'Re-laid out workflow blocks to match Mermaid direction LR.'
    )
  })
})
