import { beforeEach, describe, expect, it, vi } from 'vitest'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'

const mockLoadBaseWorkflowState = vi.hoisted(() => vi.fn())

vi.mock('@/lib/copilot/tools/server/workflow/workflow-mutation-utils', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    loadBaseWorkflowState: (...args: any[]) => mockLoadBaseWorkflowState(...args),
  }
})

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
  beforeEach(() => {
    mockLoadBaseWorkflowState.mockReset()
    mockLoadBaseWorkflowState.mockResolvedValue(BASE_WORKFLOW_STATE)
  })

  it('connects existing blocks without rewriting block internals', async () => {
    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart TD',
          '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          '  n2["Compute Indicators<br/>id: fn1<br/>type: function"]',
          '  n1 --> n2',
        ]),
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
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('Use edit_workflow_block to rename existing blocks.')
  })

  it('rejects existing block type changes instead of treating them as replacements', async () => {
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
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow(
      'Existing block ids are immutable identities in edit_workflow; this tool cannot replace an existing block or change its type.'
    )
  })

  it('adds new blocks with canonical block defaults from metadata-only labels', async () => {
    mockLoadBaseWorkflowState.mockResolvedValueOnce({
      ...BASE_WORKFLOW_STATE,
      blocks: { input1: BASE_WORKFLOW_STATE.blocks.input1 },
    })

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart TD',
          '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          '  n2["id: fn2<br/>type: function"]',
          '  n1 --> n2',
        ]),
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

  it('places new blocks after existing siblings regardless of Mermaid order', async () => {
    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart TD',
          '  n2["id: fn2<br/>type: function"]',
          '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          '  n3["Compute Indicators<br/>id: fn1<br/>type: function"]',
        ]),
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks.fn2.position).toEqual({ x: 0, y: 360 })
  })

  it('preserves existing block absolute position when moving into a container', async () => {
    mockLoadBaseWorkflowState.mockResolvedValueOnce({
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
    })

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph([
          'flowchart LR',
          '  subgraph sg_loop1["Loop<br/>id: loop1<br/>type: loop"]',
          '    n1["Compute Indicators<br/>id: fn1<br/>type: function"]',
          '  end',
        ]),
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
    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '  n1["Input Form<br/>id: input1<br/>type: input_trigger<br/>enabled: false<br/>outputs: {}<br/>data.foo: bar<br/>subBlocks.code: return 1"]',
          ]),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow(
      'Workflow graph Mermaid block "input1" includes block-internal fields (enabled, outputs, data.foo, subBlocks.code).'
    )
  })

  it('rejects omitted existing blocks without explicit removedBlockIds', async () => {
    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '  n1["Input Form<br/>id: input1<br/>type: input_trigger"]',
          ]),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow(
      'Existing block ids omitted from edit_workflow entityDocument without removedBlockIds: fn1'
    )
  })

  it('removes omitted blocks only when removedBlockIds declares intent', async () => {
    mockLoadBaseWorkflowState.mockResolvedValueOnce({
      ...BASE_WORKFLOW_STATE,
      blocks: {
        input1: BASE_WORKFLOW_STATE.blocks.input1,
        loop1: {
          id: 'loop1',
          type: 'loop',
          name: 'Loop',
          position: { x: 100, y: 100 },
          enabled: true,
          subBlocks: {},
          outputs: {},
        },
        fn1: {
          ...BASE_WORKFLOW_STATE.blocks.fn1,
          data: { parentId: 'loop1', extent: 'parent' },
        },
      },
    })

    const result = await editWorkflowServerTool.execute(
      {
        entityId: 'wf-1',
        entityDocument: graph(['flowchart TD', 'input1["Input Form"]']),
        removedBlockIds: ['loop1'],
      },
      { userId: 'user-1' }
    )

    expect(result.workflowState.blocks).toHaveProperty('input1')
    expect(result.workflowState.blocks).not.toHaveProperty('loop1')
    expect(result.workflowState.blocks).not.toHaveProperty('fn1')
    expect(result.workflowState.edges).toEqual([])
  })

  it('rejects removedBlockIds that still appear in the graph', async () => {
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
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('removedBlockIds still appear in edit_workflow entityDocument: fn1')
  })

  it('rejects old TG metadata comments in mutation input', async () => {
    await expect(
      editWorkflowServerTool.execute(
        {
          entityId: 'wf-1',
          entityDocument: graph([
            'flowchart TD',
            '%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
            '%% TG_BLOCK {"id":"input1","type":"input_trigger","name":"Input Form","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}',
          ]),
        },
        { userId: 'user-1' }
      )
    ).rejects.toThrow('Workflow graph Mermaid must not include TG_* metadata comments')
  })
})
