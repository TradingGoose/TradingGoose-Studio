import { describe, expect, it } from 'vitest'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  buildWorkflowDocumentPreviewDiff,
  parseTgMermaidToWorkflow,
  serializeWorkflowToTgMermaid,
  TG_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/studio-workflow-mermaid'

describe('studio workflow Mermaid documents', () => {
  const workflowState: WorkflowSnapshot = {
    blocks: {
      gate: {
        id: 'gate',
        type: 'condition',
        name: 'Market Hours?',
        position: { x: 176, y: 24 },
        enabled: true,
        subBlocks: {
          conditions: {
            id: 'conditions',
            type: 'condition-input',
            value: JSON.stringify([
              {
                id: 'gate-if',
                title: 'if',
                value: '{{market_open}} === true',
              },
              {
                id: 'gate-else',
                title: 'else',
                value: '',
              },
            ]),
          },
        },
        outputs: {},
      },
      loop_child: {
        id: 'loop_child',
        type: 'agent',
        name: 'Generate Signal',
        position: { x: 352, y: 160 },
        enabled: true,
        advancedMode: true,
        triggerMode: false,
        subBlocks: {
          model: { id: 'model', type: 'short-input', value: 'gpt-5.4-mini' },
        },
        outputs: {
          signal: { type: 'string' } as any,
        },
        data: {
          parentId: 'loop_parent',
          extent: 'parent',
        },
      },
      loop_parent: {
        id: 'loop_parent',
        type: 'loop',
        name: 'For Each Symbol',
        position: { x: 320, y: 24 },
        enabled: true,
        subBlocks: {},
        outputs: {
          item: { type: 'string' } as any,
        },
        data: {
          loopType: 'forEach',
          collection: '{{symbols}}',
        },
      },
      sink: {
        id: 'sink',
        type: 'telegram',
        name: 'Send Alert',
        position: { x: 640, y: 24 },
        enabled: true,
        subBlocks: {},
        outputs: {},
      },
      trigger: {
        id: 'trigger',
        type: 'webhook',
        name: 'Webhook Trigger',
        position: { x: 16, y: 24 },
        enabled: true,
        subBlocks: {
          path: { id: 'path', type: 'short-input', value: '/alerts' },
        },
        outputs: {
          payload: { type: 'object', properties: {} } as any,
        },
      },
    },
    edges: [
      {
        id: 'e-trigger-gate',
        source: 'trigger',
        target: 'gate',
        sourceHandle: 'payload',
        targetHandle: 'input',
      },
      {
        id: 'e-gate-loop',
        source: 'gate',
        target: 'loop_parent',
        sourceHandle: 'condition-gate-if',
        targetHandle: 'target',
      },
      {
        id: 'e-gate-sink',
        source: 'gate',
        target: 'sink',
        sourceHandle: 'condition-gate-else',
        targetHandle: 'target',
      },
      {
        id: 'e-loop-start-child',
        source: 'loop_parent',
        target: 'loop_child',
        sourceHandle: 'loop-start-source',
        targetHandle: 'input',
      },
      {
        id: 'e-loop-end-sink',
        source: 'loop_parent',
        target: 'sink',
        sourceHandle: 'loop-end-source',
        targetHandle: 'target',
      },
    ],
    loops: {
      loop_parent: {
        id: 'loop_parent',
        nodes: ['loop_child'],
        iterations: 0,
        loopType: 'forEach',
        forEachItems: '{{symbols}}',
      },
    },
    parallels: {},
    lastSaved: '2026-04-11T00:00:00.000Z',
    isDeployed: false,
    deployedAt: '2026-04-10T18:00:00.000Z',
  }

  it('round-trips a workflow snapshot losslessly through studio workflow Mermaid', () => {
    const document = serializeWorkflowToTgMermaid(workflowState)

    expect(document).toContain('TG_WORKFLOW {')
    expect(document).toContain(`"version":"${TG_MERMAID_DOCUMENT_FORMAT}"`)
    expect(document).toContain('TG_BLOCK {"advancedMode":true')
    expect(document).toContain('flowchart TD')
    expect(document).toContain('Loop Start')
    expect(document).toContain('Loop End')
    expect(document).toContain('id: condition-gate-if')
    expect(document).toContain('value: {{market_open}} === true')
    expect(document).toMatch(/subgraph sg_n\d+\["Market Hours\?<br\/>id: gate<br\/>type: condition/)

    expect(parseTgMermaidToWorkflow(document)).toEqual(workflowState)
  })

  it('applies visible condition branch edits back onto the canonical block config', () => {
    const document = serializeWorkflowToTgMermaid(workflowState)
    const editedDocument = document.replace(
      'value: {{market_open}} === true',
      'value: {{market_open}} === true && {{volume}} > 1000'
    )

    const parsed = parseTgMermaidToWorkflow(editedDocument)
    const conditions = JSON.parse(
      String(parsed.blocks.gate.subBlocks.conditions.value)
    ) as Array<{ title: string; value: string }>

    expect(conditions.find((entry) => entry.title === 'if')?.value).toBe(
      '{{market_open}} === true && {{volume}} > 1000'
    )
  })

  it('computes block and edge preview diffs from canonical workflow states', () => {
    const nextState: WorkflowSnapshot = {
      ...workflowState,
      blocks: {
        ...workflowState.blocks,
        sink: {
          ...workflowState.blocks.sink,
          name: 'Send Alert v2',
        },
        sink_archive: {
          id: 'sink_archive',
          type: 'notion',
          name: 'Archive Alert',
          position: { x: 760, y: 24 },
          enabled: true,
          subBlocks: {},
          outputs: {},
        },
      },
      edges: [
        ...workflowState.edges,
        {
          id: 'e-sink-archive',
          source: 'sink',
          target: 'sink_archive',
        },
      ],
    }

    expect(buildWorkflowDocumentPreviewDiff(workflowState, nextState)).toEqual({
      blockDiff: {
        added: ['sink_archive'],
        removed: [],
        updated: ['sink'],
      },
      edgeDiff: {
        added: [
          {
            source: 'sink',
            target: 'sink_archive',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
        removed: [],
      },
      warnings: [],
    })
  })
})
