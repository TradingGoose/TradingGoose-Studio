import { RepeatIcon, SplitIcon } from 'lucide-react'
import type { SubBlockConfig } from '@/blocks/types'
import type { WorkflowEditorCopy } from '@/i18n/workflow-inspector-core'

export type LoopType = 'for' | 'forEach' | 'while' | 'doWhile'
export type ParallelType = 'count' | 'collection'
export type SubflowType = LoopType | ParallelType

export const SubflowBlockConfigs = {
  loop: {
    id: 'loop',
    type: 'loop',
    name: 'Loop',
    description: 'Repeat the blocks inside a workflow container sequentially.',
    longDescription:
      'For Loop repeats a configured number of times. For Each iterates over a non-empty array or object; object items are key/value pairs. While tests its condition before each iteration, and Do While always executes its first iteration. Conditions use the same expression evaluator as Condition blocks. While and Do While have no fixed iteration cap: provide a terminating condition and account for workflow timeout and execution limits. Connect the container start to its first child and the container end to the blocks that should run afterward. Completed For and For Each loops aggregate child outputs under results in iteration order; a single iteration can contain multiple child outputs. While and Do While completion outputs do not include that results array.',
    inputs: {
      loopType: { type: 'string', description: 'for, forEach, while, or doWhile.' },
      iterations: {
        type: 'number',
        description: 'Iteration count for For Loop; the editor allows 1–100.',
      },
      forEachItems: {
        type: 'json',
        description: 'Non-empty array or object for For Each; supports upstream references.',
      },
      whileCondition: { type: 'string', description: 'Boolean expression for While or Do While.' },
    },
    outputs: {
      loopId: { type: 'string', description: 'Loop container ID.' },
      currentIteration: {
        type: 'number',
        description:
          'One-based during loop execution; completed For and For Each outputs use the final zero-based index.',
      },
      maxIterations: {
        type: 'number',
        description:
          'Count or collection length; condition-driven loops use the runtime sentinel Number.MAX_SAFE_INTEGER.',
      },
      loopType: { type: 'string', description: 'Configured loop mode.' },
      completed: { type: 'boolean', description: 'Whether the loop has finished.' },
      results: {
        type: 'array',
        description:
          'Child outputs grouped by iteration after For or For Each completes; absent from While and Do While completion outputs.',
      },
      message: { type: 'string', description: 'Loop progress message.' },
    },
    icon: RepeatIcon,
    bgColor: '#00ccff',
  },
  parallel: {
    id: 'parallel',
    type: 'parallel',
    name: 'Parallel',
    description: 'Execute copies of a workflow container concurrently.',
    longDescription:
      'Parallel Count runs between 1 and 20 copies of its child blocks. Parallel Each creates one execution per array item or object entry; the count-mode limit of 20 does not cap collection mode. Child executions share the workflow variable namespace, so concurrent writes are not isolated. Connect the container start to its first child and the container end to the downstream path. After all executions finish, results are aggregated in iteration-index order, not completion order. For object collections, each item is a key/value pair.',
    inputs: {
      parallelType: { type: 'string', description: 'count or collection.' },
      count: {
        type: 'number',
        description: 'Number of executions in count mode; clamped to 1–20.',
      },
      distribution: {
        type: 'json',
        description: 'Array or object for collection mode; supports upstream references.',
      },
    },
    outputs: {
      parallelId: { type: 'string', description: 'Parallel container ID.' },
      parallelCount: { type: 'number', description: 'Number of parallel executions.' },
      completed: { type: 'boolean', description: 'True once all executions have completed.' },
      results: {
        type: 'array',
        description: 'Completed execution results in iteration-index order.',
      },
      message: { type: 'string', description: 'Parallel progress message.' },
    },
    icon: SplitIcon,
    bgColor: '#ffdd00',
  },
} as const

export type SubflowKind = keyof typeof SubflowBlockConfigs

export function getSubflowBlockConfig(type: SubflowKind): (typeof SubflowBlockConfigs)[SubflowKind]
export function getSubflowBlockConfig(
  type: string
): (typeof SubflowBlockConfigs)[SubflowKind] | undefined
export function getSubflowBlockConfig(type: string) {
  return type === 'loop' || type === 'parallel' ? SubflowBlockConfigs[type] : undefined
}

type SubflowPanelCopy = {
  typeLabel: string
  typeOptions: Array<{ value: SubflowType; label: string }>
  countLabel: string
  valueLabel: string
  valuePlaceholder: string
  maxIterations: number
}

export function getSubflowPanelCopy(
  copy: WorkflowEditorCopy,
  kind: SubflowKind,
  isConditionMode = false
): SubflowPanelCopy {
  if (kind === 'loop') {
    return {
      typeLabel: copy.loopTypeLabel,
      typeOptions: [
        { value: 'for', label: copy.forLoop },
        { value: 'forEach', label: copy.forEachLoop },
        { value: 'while', label: copy.whileLoop },
        { value: 'doWhile', label: copy.doWhileLoop },
      ],
      countLabel: copy.loopIterations,
      valueLabel: isConditionMode ? copy.whileCondition : copy.collectionItems,
      valuePlaceholder: isConditionMode
        ? copy.whileConditionPlaceholder
        : copy.collectionItemsPlaceholder,
      maxIterations: 100,
    }
  }

  return {
    typeLabel: copy.parallelTypeLabel,
    typeOptions: [
      { value: 'count', label: copy.parallelCount },
      { value: 'collection', label: copy.parallelEach },
    ],
    countLabel: copy.parallelExecutions,
    valueLabel: copy.collectionItems,
    valuePlaceholder: copy.collectionItemsPlaceholder,
    maxIterations: 20,
  }
}

export function getSubflowPreviewSubBlocks(
  copy: WorkflowEditorCopy,
  kind: SubflowKind
): SubBlockConfig[] {
  if (kind === 'loop') {
    return [
      { id: 'loopType', title: copy.loopTypeLabel, type: 'dropdown' },
      {
        id: 'iterations',
        title: copy.loopIterations,
        type: 'short-input',
        condition: { field: 'loopType', value: 'for' },
      },
      {
        id: 'collection',
        title: copy.collectionItems,
        type: 'long-input',
        condition: { field: 'loopType', value: 'forEach' },
      },
      {
        id: 'whileCondition',
        title: copy.whileCondition,
        type: 'long-input',
        condition: { field: 'loopType', value: ['while', 'doWhile'] },
      },
    ]
  }

  return [
    { id: 'parallelType', title: copy.parallelTypeLabel, type: 'dropdown' },
    {
      id: 'count',
      title: copy.parallelExecutions,
      type: 'short-input',
      condition: { field: 'parallelType', value: 'count' },
    },
    {
      id: 'distribution',
      title: copy.collectionItems,
      type: 'long-input',
      condition: { field: 'parallelType', value: 'collection' },
    },
  ]
}
