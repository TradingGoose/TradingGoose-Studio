import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/validation', () => ({
  validateWorkflowState: (state: any) => ({
    valid: true,
    errors: [],
    warnings: [],
    sanitizedState: state,
  }),
}))

const BASE_WORKFLOW_STATE = {
  direction: 'TD',
  blocks: {
    input1: {
      id: 'input1',
      type: 'input_trigger',
      name: 'Input Form',
      position: { x: 0, y: 0 },
      enabled: true,
      subBlocks: {
        inputFormat: {
          id: 'inputFormat',
          type: 'input-format',
          value: [],
        },
      },
      outputs: {},
    },
    fn1: {
      id: 'fn1',
      type: 'function',
      name: 'Compute Indicators',
      position: { x: 0, y: 240 },
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
}

function graph(lines: string[]): string {
  return lines.join('\n')
}

describe('editWorkflowServerTool', () => {
  it('connects existing blocks without rewriting block internals', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart TD',
          '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          '  n2["Compute<br/>id: fn1<br/>type: function"]',
          '  n1 --> n2',
        ]),
        currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks.fn1.name).toBe('Compute Indicators')
    expect(result.workflowState.blocks.fn1.subBlocks.code.value).toBe('return { ok: true }')
    expect(result.workflowState.edges).toEqual([
      expect.objectContaining({
        id: 'input1-source-fn1-target',
        source: 'input1',
        target: 'fn1',
      }),
    ])
  })

  it('adds new blocks from block type defaults', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart TD',
          '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          '  n2["Transform<br/>id: fn2<br/>type: function"]',
          '  n1 --> n2',
        ]),
        currentWorkflowState: JSON.stringify({
          ...BASE_WORKFLOW_STATE,
          blocks: { input1: BASE_WORKFLOW_STATE.blocks.input1 },
        }),
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks.fn2).toMatchObject({
      id: 'fn2',
      type: 'function',
      name: expect.any(String),
      enabled: true,
    })
    expect(result.workflowState.blocks.fn2.subBlocks.code).toMatchObject({
      id: 'code',
      type: 'code',
      value: null,
    })
    expect(result.preview.blockDiff.added).toEqual(['fn2'])
  })

  it('rejects omitted existing blocks without explicit removedBlockIds', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          ]),
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow(
      'Existing block ids omitted from edit_workflow entityDocument without removedBlockIds: fn1'
    )
  })

  it('removes omitted blocks only when removedBlockIds declares intent', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          ]),
          removedBlockIds: ['fn1'],
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
    )

    expect(result.workflowState.blocks).toHaveProperty('input1')
    expect(result.workflowState.blocks).not.toHaveProperty('fn1')
    expect(result.workflowState.edges).toEqual([])
  })

  it('rejects removedBlockIds that still appear in the graph', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
            '  n2["Compute<br/>id: fn1<br/>type: function"]',
          ]),
          removedBlockIds: ['fn1'],
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('removedBlockIds still appear in edit_workflow entityDocument: fn1')
  })

  it('rejects old TG metadata comments in mutation input', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
            '%% TG_BLOCK {"id":"input1","type":"input_trigger","name":"Input Form","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}',
          ]),
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('Workflow graph Mermaid must not include TG_* metadata comments')
  })
})
