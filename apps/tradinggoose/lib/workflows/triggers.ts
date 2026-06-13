import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import { resolveTriggerExecutionIdentity, resolveTriggerIdForBlock } from '@/triggers/resolution'
import { generateMockPayloadFromOutputsDefinition } from './triggers/trigger-utils'

export const TRIGGER_TYPES = {
  INPUT: 'input_trigger',
  MANUAL: 'manual_trigger',
  CHAT: 'chat_trigger',
  API: 'api_trigger',
  WEBHOOK: 'webhook',
  SCHEDULE: 'schedule',
} as const

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

export class TriggerUtils {
  static isTriggerBlock(block: { type: string; triggerMode?: boolean }): boolean {
    const blockConfig = getBlock(block.type)

    return blockConfig?.category === 'triggers' || block.triggerMode === true
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

export type EditorTestTriggerBlock = {
  type: string
  name?: string
  triggerMode?: boolean
  subBlocks?: Record<string, { value?: unknown }>
}

function buildEditorTestTriggerInput(
  block: EditorTestTriggerBlock,
  workflowInput: unknown
): unknown {
  const inputFormat = block.subBlocks?.inputFormat?.value
  if (Array.isArray(inputFormat)) {
    const testInput: Record<string, unknown> = {}
    for (const field of inputFormat) {
      const name = field && typeof field === 'object' ? (field as { name?: unknown }).name : null
      if (typeof name === 'string' && name.length > 0) {
        testInput[name] = (field as { value?: unknown }).value
      }
    }
    return Object.keys(testInput).length > 0 ? testInput : (workflowInput ?? {})
  }

  const outputs = readBlockOutputs(block.type, block.subBlocks, true)
  return Object.keys(outputs).length > 0
    ? generateMockPayloadFromOutputsDefinition(outputs)
    : (workflowInput ?? {})
}

export function resolveEditorTestTrigger<T extends EditorTestTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>,
  workflowInput?: unknown,
  selectedBlockId?: string | null
): {
  blockId: string
  input: unknown
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
  const selectedPathNodes =
    selectedBlockId && !selectedCandidate
      ? new Set(BlockPathCalculator.findAllPathNodes(edges, selectedBlockId))
      : null
  const selectedPathCandidates =
    selectedPathNodes === null
      ? []
      : selectionCandidates.filter(([blockId]) => selectedPathNodes.has(blockId))

  if (
    !selectedCandidate &&
    (selectedPathCandidates.length > 1 ||
      (selectedPathCandidates.length === 0 && runnableCandidates.length > 1))
  ) {
    throw new Error(
      'Multiple trigger blocks found. Select one trigger block or a block on one trigger branch for Run.'
    )
  }

  const candidate =
    selectedCandidate ??
    selectedPathCandidates[0] ??
    runnableCandidates[0] ??
    (selectionCandidates.length === 1 ? selectionCandidates[0] : undefined)

  if (!candidate) {
    throw new Error('Run requires a connected non-chat trigger block')
  }

  const [blockId, block] = candidate
  resolveTriggerExecutionIdentity(block)
  if (!edges.some((edge) => edge.source === blockId)) {
    const triggerName = block.name || TriggerUtils.getDefaultTriggerName(block.type) || block.type
    throw new Error(`${triggerName} must be connected to other blocks to execute`)
  }

  return {
    blockId,
    input: buildEditorTestTriggerInput(block, workflowInput),
  }
}
