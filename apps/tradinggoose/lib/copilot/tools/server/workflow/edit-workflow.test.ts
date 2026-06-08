import { describe, expect, it, vi } from 'vitest'
import { WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'

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
          '  n2["Compute Indicators<br/>id: fn1<br/>type: function"]',
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
    expect(result.documentFormat).toBe(WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT)
    expect(result.entityDocument).not.toContain('%% TG_')
    expect(result.entityDocument).toContain('Compute Indicators')
  })

  it('rejects existing block label renames instead of ignoring them', async () => {
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
            '  n1 --> n2',
          ]),
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('Use edit_workflow_block to rename existing blocks.')

    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '  input1["Input Form"]',
            '  fn1["Compute"]',
            '  input1 --> fn1',
          ]),
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('Use edit_workflow_block to rename existing blocks.')
  })

  it('rejects existing block type changes instead of treating them as replacements', async () => {
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
            '  n2["Compute<br/>id: fn1<br/>type: agent"]',
            '  n1 --> n2',
          ]),
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow(
      'Existing block ids are immutable identities in edit_workflow; this tool cannot replace an existing block or change its type.'
    )
  })

  it('adds new blocks with canonical block defaults from metadata-only labels', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart TD',
          '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          '  n2["id: fn2<br/>type: function"]',
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
      name: 'Mock Function',
      enabled: true,
    })
    expect(result.workflowState.blocks.fn2.subBlocks.code).toMatchObject({
      id: 'code',
      type: 'code',
      value: '',
    })
    expect(result.documentFormat).toBe(WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT)
    expect(result.entityDocument).toContain('Mock Function')
    expect(result.entityDocument).not.toContain('["id: fn2')
    expect(result.preview.blockDiff.added).toEqual(['fn2'])
  })

  it('preserves existing block absolute position when moving into a container', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart LR',
          '  subgraph sg_loop1["Loop<br/>id: loop1<br/>type: loop"]',
          '    n1["Compute Indicators<br/>id: fn1<br/>type: function"]',
          '  end',
        ]),
        currentWorkflowState: JSON.stringify({
          ...BASE_WORKFLOW_STATE,
          blocks: {
            fn1: {
              ...BASE_WORKFLOW_STATE.blocks.fn1,
              position: { x: 420, y: 260 },
            },
            loop1: {
              id: 'loop1',
              type: 'loop',
              name: 'Loop',
              position: { x: 100, y: 100 },
              enabled: true,
              subBlocks: {},
              outputs: {},
            },
          },
        }),
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks.fn1.data).toMatchObject({
      parentId: 'loop1',
      extent: 'parent',
    })
    expect(result.workflowState.blocks.fn1.position).toEqual({ x: 320, y: 160 })
  })

  it('rejects block-internal fields in graph-only workflow edits', async () => {
    const { editWorkflowServerTool } = await import(
      '@/lib/copilot/tools/server/workflow/edit-workflow'
    )

    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '  n1["Input Form<br/>id: input1<br/>type: input_trigger<br/>enabled: false<br/>outputs: {}<br/>data.foo: bar<br/>subBlocks.code: return 1"]',
          ]),
          currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow(
      'Workflow graph Mermaid block "input1" includes block-internal fields (enabled, outputs, data.foo, subBlocks.code).'
    )
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
        entityDocument: graph(['flowchart TD']),
        removedBlockIds: ['input1', 'fn1'],
        currentWorkflowState: JSON.stringify(BASE_WORKFLOW_STATE),
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks).not.toHaveProperty('input1')
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
