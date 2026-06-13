import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import type { QueuedWorkflowTriggerType } from '@/services/queue'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'
import { generateMockPayloadFromOutputsDefinition } from './triggers/trigger-utils'

export const TRIGGER_TYPES = {
  INPUT: 'input_trigger',
  MANUAL: 'manual_trigger',
  CHAT: 'chat_trigger',
  API: 'api_trigger',
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
} as const

export type TriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES]

const EDITOR_TEST_TRIGGER_TYPES: Partial<Record<string, QueuedWorkflowTriggerType>> = {
  [TRIGGER_TYPES.API]: 'api',
  [TRIGGER_TYPES.SCHEDULE]: 'schedule',
  [TRIGGER_TYPES.INPUT]: 'manual',
  [TRIGGER_TYPES.MANUAL]: 'manual',
}

/**
 * Mapping from reference alias (used in inline refs like <api.*>, <chat.*>, etc.)
 * to concrete trigger block type identifiers used across the system.
 */
export const TRIGGER_REFERENCE_ALIAS_MAP = {
  start: TRIGGER_TYPES.INPUT,
  api: TRIGGER_TYPES.API,
  chat: TRIGGER_TYPES.CHAT,
  manual: TRIGGER_TYPES.INPUT,
} as const

export type TriggerReferenceAlias = keyof typeof TRIGGER_REFERENCE_ALIAS_MAP

export class TriggerUtils {
  static isTriggerBlock(block: { type: string; triggerMode?: boolean }): boolean {
    const blockConfig = getBlock(block.type)

    return blockConfig?.category === 'triggers' || block.triggerMode === true
  }

  static isChatTrigger(block: { type: string; subBlocks?: any }): boolean {
    return block.type === TRIGGER_TYPES.CHAT
  }

  static isManualTrigger(block: { type: string; subBlocks?: any }): boolean {
    return block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.MANUAL
  }

  static isApiTrigger(block: { type: string; subBlocks?: any }, isChildWorkflow = false): boolean {
    if (isChildWorkflow) {
      return block.type === TRIGGER_TYPES.INPUT
    }
    return block.type === TRIGGER_TYPES.API
  }

  static getDefaultTriggerName(triggerType: string): string | null {
    const block = getBlock(triggerType)
    if (
      block &&
      (block.category === 'triggers' ||
        block.triggers?.enabled === true ||
        block.subBlocks.some((subBlock) => subBlock.mode === 'trigger'))
    ) {
      if (triggerType === 'generic_webhook') {
        return 'Webhook'
      }
      return block.name
    }

    return null
  }

  static findTriggersByType<T extends { type: string; subBlocks?: any }>(
    blocks: T[] | Record<string, T>,
    triggerType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): T[] {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)

    switch (triggerType) {
      case 'chat':
        return blockArray.filter((block) => TriggerUtils.isChatTrigger(block))
      case 'manual':
        return blockArray.filter((block) => TriggerUtils.isManualTrigger(block))
      case 'api':
        return blockArray.filter((block) => TriggerUtils.isApiTrigger(block, isChildWorkflow))
      default:
        return []
    }
  }

  static findStartBlock<T extends { type: string; subBlocks?: any }>(
    blocks: Record<string, T>,
    executionType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): { blockId: string; block: T } | null {
    const entries = Object.entries(blocks)

    const triggers = TriggerUtils.findTriggersByType(blocks, executionType, isChildWorkflow)
    if (triggers.length > 0) {
      const blockId = entries.find(([, b]) => b === triggers[0])?.[0]
      if (blockId) {
        return { blockId, block: triggers[0] }
      }
    }

    return null
  }

  static requiresSingleInstance(triggerType: string): boolean {
    // Each trigger type can only have one instance of itself
    // Manual and Input Form can coexist
    // API, Chat triggers must be unique
    // Schedules and webhooks can have multiple instances
    return (
      triggerType === TRIGGER_TYPES.API ||
      triggerType === TRIGGER_TYPES.INPUT ||
      triggerType === TRIGGER_TYPES.MANUAL ||
      triggerType === TRIGGER_TYPES.CHAT
    )
  }

  static wouldViolateSingleInstance<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)

    if (triggerType === TRIGGER_TYPES.INPUT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.INPUT)
    }

    if (triggerType === TRIGGER_TYPES.MANUAL) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.MANUAL)
    }

    if (triggerType === TRIGGER_TYPES.API) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.API)
    }

    if (triggerType === TRIGGER_TYPES.CHAT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.CHAT)
    }

    if (!TriggerUtils.requiresSingleInstance(triggerType)) {
      return false
    }

    return blockArray.some((block) => block.type === triggerType)
  }

  static getTriggerAdditionIssue<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): { issue: 'duplicate'; triggerName: string } | null {
    if (!TriggerUtils.wouldViolateSingleInstance(blocks, triggerType)) {
      return null
    }

    const triggerName = TriggerUtils.getDefaultTriggerName(triggerType) || 'trigger'
    return { issue: 'duplicate', triggerName }
  }
}

type EditorTestTriggerBlock = {
  type: string
  name?: string
  triggerMode?: boolean
  subBlocks?: Record<string, { value?: unknown }>
}

function buildEditorTestTriggerInput(
  block: EditorTestTriggerBlock,
  workflowInput: unknown
): unknown {
  if (block.triggerMode === true && !resolveTriggerIdForBlock(block)) {
    const blockConfig = getBlock(block.type)
    throw new Error(
      `${block.name || blockConfig?.name || block.type} requires a selected trigger type`
    )
  }

  if (Array.isArray(block.subBlocks?.inputFormat?.value)) {
    const testInput = block.subBlocks.inputFormat.value.reduce<Record<string, unknown>>(
      (input, field) => {
        if (field && typeof field === 'object' && 'name' in field && 'value' in field) {
          const name = (field as { name?: unknown }).name
          if (typeof name === 'string' && name.length > 0) {
            input[name] = (field as { value?: unknown }).value
          }
        }
        return input
      },
      {}
    )
    return Object.keys(testInput).length > 0 ? testInput : (workflowInput ?? {})
  }

  const outputs = readBlockOutputs(block.type, block.subBlocks, true)
  return Object.keys(outputs).length > 0
    ? generateMockPayloadFromOutputsDefinition(outputs)
    : (workflowInput ?? {})
}

export function resolveEditorTestTrigger<T extends EditorTestTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string }>,
  workflowInput?: unknown,
  selectedBlockId?: string | null
): {
  blockId: string
  input: unknown
  triggerType: QueuedWorkflowTriggerType
} {
  const entries = Object.entries(blocks)
  const candidates = entries.filter(
    ([, block]) => TriggerUtils.isTriggerBlock(block) && block.type !== TRIGGER_TYPES.CHAT
  )
  const selectedCandidate = candidates.find(([blockId]) => blockId === selectedBlockId)
  const connectedCandidates = candidates.filter(([blockId]) =>
    edges.some((edge) => edge.source === blockId)
  )
  const selectionCandidates = connectedCandidates.length > 0 ? connectedCandidates : candidates
  const runnableCandidates = selectionCandidates.filter(
    ([, block]) => block.triggerMode !== true || resolveTriggerIdForBlock(block) !== null
  )

  if (!selectedCandidate && runnableCandidates.length > 1) {
    throw new Error('Multiple runnable trigger blocks found. Keep one trigger connected for Run.')
  }

  const candidate =
    selectedCandidate ??
    runnableCandidates[0] ??
    (selectionCandidates.length === 1 ? selectionCandidates[0] : undefined)

  if (!candidate) {
    throw new Error('Run requires a connected non-chat trigger block')
  }

  const [blockId, block] = candidate
  if (!edges.some((edge) => edge.source === blockId)) {
    const triggerName = block.name || TriggerUtils.getDefaultTriggerName(block.type) || block.type
    throw new Error(`${triggerName} must be connected to other blocks to execute`)
  }

  return {
    blockId,
    input: buildEditorTestTriggerInput(block, workflowInput),
    triggerType: EDITOR_TEST_TRIGGER_TYPES[block.type] ?? 'webhook',
  }
}
