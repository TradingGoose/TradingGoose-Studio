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
    direction: 'LR',
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

  const parallelWorkflowState: WorkflowSnapshot = {
    direction: 'LR',
    blocks: {
      inputTrigger: {
        id: 'inputTrigger',
        type: 'input_trigger',
        name: 'Input Form',
        position: { x: 0, y: 0 },
        enabled: true,
        subBlocks: {},
        outputs: {},
      },
      parallel1: {
        id: 'parallel1',
        type: 'parallel',
        name: 'Parallel Research',
        position: { x: 240, y: 0 },
        enabled: true,
        subBlocks: {},
        outputs: {},
      },
      redditPosts: {
        id: 'redditPosts',
        type: 'reddit',
        name: 'Reddit Posts',
        position: { x: 480, y: 120 },
        enabled: true,
        subBlocks: {},
        outputs: {},
        data: {
          parentId: 'parallel1',
          extent: 'parent',
        },
      },
      xSearch: {
        id: 'xSearch',
        type: 'x',
        name: 'X Search',
        position: { x: 480, y: 0 },
        enabled: true,
        subBlocks: {},
        outputs: {},
        data: {
          parentId: 'parallel1',
          extent: 'parent',
        },
      },
    },
    edges: [
      {
        id: 'e-input-parallel',
        source: 'inputTrigger',
        target: 'parallel1',
      },
      {
        id: 'e-parallel-x',
        source: 'parallel1',
        target: 'xSearch',
      },
      {
        id: 'e-parallel-reddit',
        source: 'parallel1',
        target: 'redditPosts',
      },
    ],
    loops: {},
    parallels: {
      parallel1: {
        id: 'parallel1',
        nodes: ['redditPosts', 'xSearch'],
        count: 2,
        parallelType: 'count',
      },
    },
  }

  it('round-trips a workflow snapshot losslessly through studio workflow Mermaid', () => {
    const document = serializeWorkflowToTgMermaid(workflowState)

    expect(document).toContain('TG_WORKFLOW {')
    expect(document).toContain(`"version":"${TG_MERMAID_DOCUMENT_FORMAT}"`)
    expect(document).toContain('TG_BLOCK {"advancedMode":true')
    expect(document).toContain('flowchart LR')
    expect(document).toContain('Loop Start')
    expect(document).toContain('Loop End')
    expect(document).toContain('id: condition-gate-if')
    expect(document).toContain('value: {{market_open}} === true')
    expect(document).toMatch(/subgraph sg_n\d+\["Market Hours\?<br\/>id: gate<br\/>type: condition/)

    const parsed = parseTgMermaidToWorkflow(document)
    const canonicalDocument = serializeWorkflowToTgMermaid(parsed)

    expect(parsed.blocks.gate.type).toBe(workflowState.blocks.gate.type)
    expect(parsed.blocks.loop_child.type).toBe(workflowState.blocks.loop_child.type)
    expect(parsed.edges).toEqual(workflowState.edges)
    expect(parsed.loops).toEqual(workflowState.loops)
    expect(parsed.parallels).toEqual(workflowState.parallels)
    expect(parseTgMermaidToWorkflow(canonicalDocument)).toEqual(parsed)
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

  it('round-trips parallel container edge forms losslessly through studio workflow Mermaid', () => {
    const document = serializeWorkflowToTgMermaid(parallelWorkflowState)

    expect(document).toContain('Parallel Start')
    expect(document).toContain('Parallel End')
    expect(document).toContain('n2 --> n4')
    expect(document).toContain('n2 --> n3')

    const parsed = parseTgMermaidToWorkflow(document)

    expect(parsed.edges).toEqual(parallelWorkflowState.edges)
    expect(parsed.parallels).toEqual(parallelWorkflowState.parallels)
  })

  it('rejects TG_BLOCK payloads that omit the canonical type field', () => {
    const invalidDocument = `flowchart TD
%% TG_WORKFLOW {"direction":"TD","version":"tg-mermaid-v1"}
n1["Agent<br/>id: block_1<br/>type: agent<br/>enabled: true"]
%% TG_BLOCK {"id":"block_1","blockType":"agent","name":"Agent","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}
`

    expect(() => parseTgMermaidToWorkflow(invalidDocument)).toThrow(
      'Invalid TG_BLOCK payload: expected object with string id and string type. Workflow documents use `type`, not `blockType`.'
    )
  })

  it('rejects TG_BLOCK payloads that omit canonical workflow state fields', () => {
    const invalidDocument = `flowchart TD
%% TG_WORKFLOW {"direction":"TD","version":"tg-mermaid-v1"}
n1["Agent<br/>id: block_1<br/>type: agent<br/>enabled: true"]
%% TG_BLOCK {"id":"block_1","type":"agent","name":"Agent","subBlocks":{},"outputs":{},"enabled":true}
`

    expect(() => parseTgMermaidToWorkflow(invalidDocument)).toThrow(
      'Invalid TG_BLOCK payload: expected position with numeric x and y values.'
    )
  })

  it('rejects documents whose visible Mermaid connections omit canonical TG_EDGE payloads', () => {
    const invalidDocument = `flowchart TD
%% TG_WORKFLOW {"direction":"TD","version":"tg-mermaid-v1"}
n1["Trigger<br/>id: trigger<br/>type: input_trigger<br/>enabled: true"]
n2["Agent<br/>id: agent<br/>type: agent<br/>enabled: true"]
n1 --> n2
%% TG_BLOCK {"id":"trigger","type":"input_trigger","name":"Trigger","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}
%% TG_BLOCK {"id":"agent","type":"agent","name":"Agent","position":{"x":240,"y":0},"subBlocks":{},"outputs":{},"enabled":true}
`

    expect(() => parseTgMermaidToWorkflow(invalidDocument)).toThrow(
      'Workflow document contains Mermaid connection lines but no TG_EDGE entries. Every visible workflow connection must have a matching TG_EDGE payload.'
    )
  })

  it('rejects documents whose visible parallel container connections drift from canonical TG_EDGE payloads', () => {
    const invalidDocument = serializeWorkflowToTgMermaid(parallelWorkflowState)
      .replace('\n  n2 --> n4', '\n  n2__parallel_start --> n4')
      .replace('\n  n2 --> n3', '\n  n2__parallel_start --> n3')

    expect(() => parseTgMermaidToWorkflow(invalidDocument)).toThrow(
      'Workflow document edge metadata is inconsistent. Visible Mermaid connections and TG_EDGE payloads must match exactly. missing TG_EDGE entries for parallel1:parallel-start-source->xSearch:target, parallel1:parallel-start-source->redditPosts:target; missing visible connection lines for parallel1:source->xSearch:target, parallel1:source->redditPosts:target; expected visible lines like `n2 --> n4`, `n2 --> n3`.'
    )
  })

  it('accepts documents whose visible node ids are raw block ids using Mermaid ([...]) node syntax', () => {
    const document = `flowchart TD
%% TG_WORKFLOW {"direction":"TD","isDeployed":false,"lastSaved":1776131914844,"version":"tg-mermaid-v1"}
inputTrigger(["Input Form"])
%% TG_BLOCK {"id":"inputTrigger","type":"input_trigger","name":"Input Form","position":{"x":600,"y":40},"subBlocks":{},"outputs":{},"enabled":true}
agentBlock(["Agent"])
%% TG_BLOCK {"id":"agentBlock","type":"agent","name":"Agent","position":{"x":600,"y":280},"subBlocks":{"model":{"id":"model","type":"string","value":"gpt-4o"},"apiKey":{"id":"apiKey","type":"string","value":""}},"outputs":{},"enabled":true}
inputTrigger --> agentBlock
%% TG_EDGE {"source":"inputTrigger","target":"agentBlock"}
`

    const parsed = parseTgMermaidToWorkflow(document)

    expect(parsed.edges).toEqual([
      {
        id: 'inputTrigger-source-agentBlock-target',
        source: 'inputTrigger',
        target: 'agentBlock',
      },
    ])
    expect(parsed.blocks.inputTrigger.type).toBe('input_trigger')
    expect(parsed.blocks.agentBlock.type).toBe('agent')
  })

  it('infers LR when serializing horizontally positioned workflows without explicit direction', () => {
    const { direction: _direction, ...workflowWithoutDirection } = parallelWorkflowState
    const document = serializeWorkflowToTgMermaid(workflowWithoutDirection)

    expect(document).toContain('flowchart LR')
    expect(document).toContain('%% TG_WORKFLOW {"direction":"LR"')
  })

  it('reports missing raw-id visible edge lines using the document naming style', () => {
    const invalidDocument = `flowchart TD
%% TG_WORKFLOW {"direction":"TD","isDeployed":false,"lastSaved":1776131914844,"version":"tg-mermaid-v1"}
inputTrigger(["Input Form"])
%% TG_BLOCK {"id":"inputTrigger","type":"input_trigger","name":"Input Form","position":{"x":600,"y":40},"subBlocks":{},"outputs":{},"enabled":true}
agentBlock(["Agent"])
%% TG_BLOCK {"id":"agentBlock","type":"agent","name":"Agent","position":{"x":600,"y":280},"subBlocks":{"model":{"id":"model","type":"string","value":"gpt-4o"},"apiKey":{"id":"apiKey","type":"string","value":""}},"outputs":{},"enabled":true}
%% TG_EDGE {"source":"inputTrigger","target":"agentBlock"}
`

    expect(() => parseTgMermaidToWorkflow(invalidDocument)).toThrow(
      'Workflow document edge metadata is inconsistent. Visible Mermaid connections and TG_EDGE payloads must match exactly. missing visible connection lines for inputTrigger:source->agentBlock:target; expected visible lines like `inputTrigger --> agentBlock`.'
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
