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
    icon: RepeatIcon,
    bgColor: '#00ccff',
  },
  parallel: {
    id: 'parallel',
    type: 'parallel',
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
