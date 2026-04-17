import type { Edge } from 'reactflow'
import {
  serializeWorkflowToTgMermaid,
  TG_BLOCK_PREFIX,
  TG_EDGE_PREFIX,
  TG_WORKFLOW_PREFIX,
} from '@/lib/workflows/studio-workflow-mermaid'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getBlock } from '@/blocks'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

export type WorkflowBlockMermaidRenderKind =
  | 'standard'
  | 'condition'
  | 'loop_container'
  | 'parallel_container'

export interface WorkflowBlockMermaidContract {
  renderKind: WorkflowBlockMermaidRenderKind
  requiresSubgraph: boolean
  childrenPlacement: 'none' | 'inside_container' | 'outside_container'
  incomingEdgeTarget: 'block' | 'container_start'
  outgoingEdgeSource: 'block' | 'container_end' | 'condition_branch'
  conditionBranchNodePattern?: string
  conditionBranchHandlePattern?: string
  containerStartNodePattern?: string
  containerEndNodePattern?: string
  canonicalCommentPrefixes: {
    workflow: string
    block: string
    edge: string
  }
}

export interface WorkflowBlockMermaidExamples {
  minimalDocument: string
  connectedDocument: string
}

export interface WorkflowBlockMermaidShape {
  mermaidContract: WorkflowBlockMermaidContract
  mermaidExamples: WorkflowBlockMermaidExamples
}

type ExampleParams = {
  blockType: string
  blockName: string
  operation?: string
}

const CONDITION_INPUT_KEY = 'conditions'

function createBlockState(params: {
  id: string
  type: string
  name: string
  x: number
  y: number
  subBlocks?: BlockState['subBlocks']
  data?: BlockState['data']
}): BlockState {
  return {
    id: params.id,
    type: params.type,
    name: params.name,
    position: { x: params.x, y: params.y },
    subBlocks: params.subBlocks ?? {},
    outputs: {},
    enabled: true,
    ...(params.data ? { data: params.data } : {}),
  }
}

function createEdge(params: {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}): Edge {
  return {
    id: params.id,
    source: params.source,
    target: params.target,
    ...(params.sourceHandle ? { sourceHandle: params.sourceHandle } : {}),
    ...(params.targetHandle ? { targetHandle: params.targetHandle } : {}),
  }
}

function createConditionSubBlocks(blockId: string): BlockState['subBlocks'] {
  return {
    [CONDITION_INPUT_KEY]: {
      id: CONDITION_INPUT_KEY,
      type: 'condition-input',
      value: JSON.stringify([
        {
          id: `${blockId}-if`,
          title: 'if',
          value: '<a_input.result> === true',
          showTags: false,
          showEnvVars: false,
          searchTerm: '',
          cursorPosition: 0,
          activeSourceBlockId: null,
        },
        {
          id: `${blockId}-else`,
          title: 'else',
          value: '',
          showTags: false,
          showEnvVars: false,
          searchTerm: '',
          cursorPosition: 0,
          activeSourceBlockId: null,
        },
      ]),
    },
  }
}

function createTargetSubBlocks(params: ExampleParams): BlockState['subBlocks'] {
  const blockConfig = getBlock(params.blockType)
  const subBlocks: BlockState['subBlocks'] = {}

  for (const subBlock of blockConfig?.subBlocks ?? []) {
    if (subBlock.id === 'operation') {
      if (params.operation) {
        subBlocks.operation = {
          id: 'operation',
          type: 'dropdown',
          value: params.operation,
        }
      }
      continue
    }

    if (subBlock.type === 'input-format' || subBlock.type === 'response-format') {
      subBlocks[subBlock.id] = {
        id: subBlock.id,
        type: subBlock.type,
        value: [
          {
            id: `${params.blockType}-${subBlock.id}-field-1`,
            name: 'fieldName',
            type: 'string',
            value: 'example',
            collapsed: false,
          },
        ],
      }
    }
  }

  return subBlocks
}

function buildStandardWorkflowExamples(params: ExampleParams): WorkflowBlockMermaidExamples {
  const minimalState: WorkflowSnapshot = {
    direction: 'TD',
    blocks: {
      b_target: createBlockState({
        id: 'b_target',
        type: params.blockType,
        name: params.blockName,
        x: 280,
        y: 160,
        subBlocks: createTargetSubBlocks(params),
      }),
    },
    edges: [],
    loops: {},
    parallels: {},
  }

  const connectedState: WorkflowSnapshot = {
    direction: 'TD',
    blocks: {
      a_input: createBlockState({
        id: 'a_input',
        type: 'workflow_input',
        name: 'Input',
        x: 80,
        y: 40,
      }),
      b_target: createBlockState({
        id: 'b_target',
        type: params.blockType,
        name: params.blockName,
        x: 280,
        y: 220,
        subBlocks: createTargetSubBlocks(params),
      }),
      c_next: createBlockState({
        id: 'c_next',
        type: 'function',
        name: 'Next Step',
        x: 520,
        y: 380,
      }),
    },
    edges: [
      createEdge({
        id: 'a_input-source-b_target-target',
        source: 'a_input',
        target: 'b_target',
      }),
      createEdge({
        id: 'b_target-source-c_next-target',
        source: 'b_target',
        target: 'c_next',
      }),
    ],
    loops: {},
    parallels: {},
  }

  return {
    minimalDocument: serializeWorkflowToTgMermaid(minimalState),
    connectedDocument: serializeWorkflowToTgMermaid(connectedState),
  }
}

function buildConditionWorkflowExamples(params: ExampleParams): WorkflowBlockMermaidExamples {
  const minimalState: WorkflowSnapshot = {
    direction: 'TD',
    blocks: {
      b_condition: createBlockState({
        id: 'b_condition',
        type: params.blockType,
        name: params.blockName,
        x: 280,
        y: 160,
        subBlocks: createConditionSubBlocks('b_condition'),
      }),
    },
    edges: [],
    loops: {},
    parallels: {},
  }

  const connectedState: WorkflowSnapshot = {
    direction: 'TD',
    blocks: {
      a_input: createBlockState({
        id: 'a_input',
        type: 'workflow_input',
        name: 'Input',
        x: 80,
        y: 40,
      }),
      b_condition: createBlockState({
        id: 'b_condition',
        type: params.blockType,
        name: params.blockName,
        x: 280,
        y: 200,
        subBlocks: createConditionSubBlocks('b_condition'),
      }),
      c_true: createBlockState({
        id: 'c_true',
        type: 'function',
        name: 'If Branch',
        x: 520,
        y: 120,
      }),
      d_false: createBlockState({
        id: 'd_false',
        type: 'function',
        name: 'Else Branch',
        x: 520,
        y: 320,
      }),
    },
    edges: [
      createEdge({
        id: 'a_input-source-b_condition-target',
        source: 'a_input',
        target: 'b_condition',
      }),
      createEdge({
        id: 'b_condition-if-c_true-target',
        source: 'b_condition',
        target: 'c_true',
        sourceHandle: 'condition-b_condition-if',
      }),
      createEdge({
        id: 'b_condition-else-d_false-target',
        source: 'b_condition',
        target: 'd_false',
        sourceHandle: 'condition-b_condition-else',
      }),
    ],
    loops: {},
    parallels: {},
  }

  return {
    minimalDocument: serializeWorkflowToTgMermaid(minimalState),
    connectedDocument: serializeWorkflowToTgMermaid(connectedState),
  }
}

function buildContainerWorkflowExamples(
  params: ExampleParams & { renderKind: 'loop_container' | 'parallel_container' }
): WorkflowBlockMermaidExamples {
  const containerId = 'b_container'
  const childId = 'c_child'

  const minimalState: WorkflowSnapshot = {
    direction: 'TD',
    blocks: {
      [containerId]: createBlockState({
        id: containerId,
        type: params.blockType,
        name: params.blockName,
        x: 240,
        y: 120,
      }),
      [childId]: createBlockState({
        id: childId,
        type: 'function',
        name: 'Child Block',
        x: 120,
        y: 80,
        data: {
          parentId: containerId,
          extent: 'parent',
        },
      }),
    },
    edges: [],
    loops:
      params.renderKind === 'loop_container'
        ? ({
            [containerId]: {
              id: containerId,
              nodes: [childId],
              iterations: 3,
              loopType: 'for',
            } satisfies Loop,
          } as Record<string, Loop>)
        : {},
    parallels:
      params.renderKind === 'parallel_container'
        ? ({
            [containerId]: {
              id: containerId,
              nodes: [childId],
              count: 2,
              parallelType: 'count',
            } satisfies Parallel,
          } as Record<string, Parallel>)
        : {},
  }

  const connectedState: WorkflowSnapshot = {
    direction: 'TD',
    blocks: {
      a_input: createBlockState({
        id: 'a_input',
        type: 'workflow_input',
        name: 'Input',
        x: 80,
        y: 40,
      }),
      [containerId]: createBlockState({
        id: containerId,
        type: params.blockType,
        name: params.blockName,
        x: 260,
        y: 140,
      }),
      [childId]: createBlockState({
        id: childId,
        type: 'function',
        name: 'Child Block',
        x: 120,
        y: 80,
        data: {
          parentId: containerId,
          extent: 'parent',
        },
      }),
      d_next: createBlockState({
        id: 'd_next',
        type: 'function',
        name: 'Next Step',
        x: 560,
        y: 360,
      }),
    },
    edges: [
      createEdge({
        id: 'a_input-source-c_child-target',
        source: 'a_input',
        target: childId,
      }),
      createEdge({
        id: 'c_child-source-d_next-target',
        source: childId,
        target: 'd_next',
      }),
    ],
    loops:
      params.renderKind === 'loop_container'
        ? ({
            [containerId]: {
              id: containerId,
              nodes: [childId],
              iterations: 3,
              loopType: 'for',
            } satisfies Loop,
          } as Record<string, Loop>)
        : {},
    parallels:
      params.renderKind === 'parallel_container'
        ? ({
            [containerId]: {
              id: containerId,
              nodes: [childId],
              count: 2,
              parallelType: 'count',
            } satisfies Parallel,
          } as Record<string, Parallel>)
        : {},
  }

  return {
    minimalDocument: serializeWorkflowToTgMermaid(minimalState),
    connectedDocument: serializeWorkflowToTgMermaid(connectedState),
  }
}

function resolveRenderKind(blockType: string): WorkflowBlockMermaidRenderKind {
  if (blockType === 'condition') return 'condition'
  if (blockType === 'loop') return 'loop_container'
  if (blockType === 'parallel') return 'parallel_container'
  return 'standard'
}

export function buildWorkflowBlockMermaidShape(params: ExampleParams): WorkflowBlockMermaidShape {
  const renderKind = resolveRenderKind(params.blockType)

  const baseContract = {
    canonicalCommentPrefixes: {
      workflow: TG_WORKFLOW_PREFIX,
      block: TG_BLOCK_PREFIX,
      edge: TG_EDGE_PREFIX,
    },
  }

  switch (renderKind) {
    case 'condition':
      return {
        mermaidContract: {
          renderKind,
          requiresSubgraph: true,
          childrenPlacement: 'outside_container',
          incomingEdgeTarget: 'block',
          outgoingEdgeSource: 'condition_branch',
          conditionBranchNodePattern: '<alias>__condition_<branchKey>',
          conditionBranchHandlePattern: 'condition-<blockId>-<branchKey>',
          ...baseContract,
        },
        mermaidExamples: buildConditionWorkflowExamples(params),
      }
    case 'loop_container':
      return {
        mermaidContract: {
          renderKind,
          requiresSubgraph: true,
          childrenPlacement: 'inside_container',
          incomingEdgeTarget: 'container_start',
          outgoingEdgeSource: 'container_end',
          containerStartNodePattern: '<alias>__loop_start',
          containerEndNodePattern: '<alias>__loop_end',
          ...baseContract,
        },
        mermaidExamples: buildContainerWorkflowExamples({
          ...params,
          renderKind,
        }),
      }
    case 'parallel_container':
      return {
        mermaidContract: {
          renderKind,
          requiresSubgraph: true,
          childrenPlacement: 'inside_container',
          incomingEdgeTarget: 'container_start',
          outgoingEdgeSource: 'container_end',
          containerStartNodePattern: '<alias>__parallel_start',
          containerEndNodePattern: '<alias>__parallel_end',
          ...baseContract,
        },
        mermaidExamples: buildContainerWorkflowExamples({
          ...params,
          renderKind,
        }),
      }
    default:
      return {
        mermaidContract: {
          renderKind,
          requiresSubgraph: false,
          childrenPlacement: 'none',
          incomingEdgeTarget: 'block',
          outgoingEdgeSource: 'block',
          ...baseContract,
        },
        mermaidExamples: buildStandardWorkflowExamples(params),
      }
  }
}
