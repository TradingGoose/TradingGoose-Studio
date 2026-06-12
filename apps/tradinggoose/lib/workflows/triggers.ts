import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import type { QueuedWorkflowTriggerType } from '@/services/queue'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'
import { generateMockPayloadFromOutputsDefinition } from './triggers/trigger-utils'

/**
 * Unified trigger type definitions
 */
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
  [TRIGGER_TYPES.CHAT]: 'chat',
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

/**
 * Trigger classification and utilities
 */
export class TriggerUtils {
  /**
   * Check if a block is any kind of trigger
   */
  static isTriggerBlock(block: { type: string; triggerMode?: boolean }): boolean {
    const blockConfig = getBlock(block.type)

    return (
      // New trigger blocks (explicit category)
      blockConfig?.category === 'triggers' ||
      // Blocks with trigger mode enabled
      block.triggerMode === true
    )
  }

  /**
   * Check if a block is a chat trigger
   */
  static isChatTrigger(block: { type: string; subBlocks?: any }): boolean {
    return block.type === TRIGGER_TYPES.CHAT
  }

  /**
   * Check if a block is a manual trigger
   */
  static isManualTrigger(block: { type: string; subBlocks?: any }): boolean {
    return block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.MANUAL
  }

  /**
   * Check if a block is an API trigger
   * @param block - Block to check
   * @param isChildWorkflow - Whether this is being called from a child workflow context
   */
  static isApiTrigger(block: { type: string; subBlocks?: any }, isChildWorkflow = false): boolean {
    if (isChildWorkflow) {
      // Child workflows (workflow-in-workflow) only work with input_trigger
      return block.type === TRIGGER_TYPES.INPUT
    }
    // Direct API calls only work with api_trigger
    return block.type === TRIGGER_TYPES.API
  }

  /**
   * Get the default name for a trigger type
   */
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

  /**
   * Find trigger blocks of a specific type in a workflow
   */
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

  /**
   * Find the appropriate start block for a given execution context
   */
  static findStartBlock<T extends { type: string; subBlocks?: any }>(
    blocks: Record<string, T>,
    executionType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): { blockId: string; block: T } | null {
    const entries = Object.entries(blocks)

    // Look for new trigger blocks first
    const triggers = TriggerUtils.findTriggersByType(blocks, executionType, isChildWorkflow)
    if (triggers.length > 0) {
      const blockId = entries.find(([, b]) => b === triggers[0])?.[0]
      if (blockId) {
        return { blockId, block: triggers[0] }
      }
    }

    return null
  }

  /**
   * Check if a trigger type requires single instance constraint
   */
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

  /**
   * Check if adding a trigger would violate single instance constraint
   */
  static wouldViolateSingleInstance<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)

    // Only one Input trigger allowed
    if (triggerType === TRIGGER_TYPES.INPUT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.INPUT)
    }

    // Only one Manual trigger allowed
    if (triggerType === TRIGGER_TYPES.MANUAL) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.MANUAL)
    }

    // Only one API trigger allowed
    if (triggerType === TRIGGER_TYPES.API) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.API)
    }

    // Chat trigger must be unique
    if (triggerType === TRIGGER_TYPES.CHAT) {
      return blockArray.some((block) => block.type === TRIGGER_TYPES.CHAT)
    }

    // Centralized rule: only API, Input, Chat are single-instance
    if (!TriggerUtils.requiresSingleInstance(triggerType)) {
      return false
    }

    return blockArray.some((block) => block.type === triggerType)
  }

  /**
   * Evaluate whether adding a trigger of the given type is allowed and, if not, why.
   * Returns null if allowed; otherwise returns an object describing the violation.
   * This avoids duplicating UI logic across toolbar/drop handlers.
   */
  static getTriggerAdditionIssue<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): { issue: 'duplicate'; triggerName: string } | null {
    if (!TriggerUtils.wouldViolateSingleInstance(blocks, triggerType)) {
      return null
    }

    // Otherwise treat as duplicate of a single-instance trigger
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
  if (block.type === TRIGGER_TYPES.CHAT) {
    if (workflowInput && typeof workflowInput === 'object') return workflowInput
    return { input: typeof workflowInput === 'string' ? workflowInput : 'Test message' }
  }

  if (block.triggerMode === true && !resolveTriggerIdForBlock(block)) {
    const blockConfig = getBlock(block.type)
    throw new Error(
      `${block.name || blockConfig?.name || block.type} requires a selected trigger type`
    )
  }

  if (Array.isArray(block.subBlocks?.inputFormat?.value)) {
    // Executor reads persisted input-format test values from serialized workflow params.
    return workflowInput ?? {}
  }

  const outputs = readBlockOutputs(block.type, block.subBlocks, true)
  return Object.keys(outputs).length > 0
    ? generateMockPayloadFromOutputsDefinition(outputs)
    : (workflowInput ?? {})
}

export function resolveEditorTestTrigger<T extends EditorTestTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string }>,
  workflowInput?: unknown
): {
  blockId: string
  input: unknown
  triggerType: QueuedWorkflowTriggerType
} {
  const entries = Object.entries(blocks)

  if (entries.filter(([, block]) => block.type === TRIGGER_TYPES.API).length > 1) {
    throw new Error('Multiple API Trigger blocks found. Keep only one.')
  }

  const candidates = entries.filter(([, block]) => TriggerUtils.isTriggerBlock(block))
  const connectedCandidates = candidates.filter(([blockId]) =>
    edges.some((edge) => edge.source === blockId)
  )
  const selectionCandidates = connectedCandidates.length > 0 ? connectedCandidates : candidates
  const runnableCandidates = selectionCandidates.filter(
    ([, block]) => block.triggerMode !== true || resolveTriggerIdForBlock(block) !== null
  )
  const runCandidates = runnableCandidates.length > 0 ? runnableCandidates : selectionCandidates
  const singletonCandidate =
    runCandidates.find(([, block]) => block.type === TRIGGER_TYPES.API) ??
    runCandidates.find(([, block]) => block.type === TRIGGER_TYPES.MANUAL) ??
    runCandidates.find(([, block]) => block.type === TRIGGER_TYPES.INPUT)

  const externalCandidates = runCandidates.filter(([, block]) => block.type !== TRIGGER_TYPES.CHAT)
  if (
    connectedCandidates.length > 0 &&
    runnableCandidates.length > 0 &&
    !singletonCandidate &&
    externalCandidates.length > 1
  ) {
    throw new Error('Multiple runnable trigger blocks found. Keep one trigger connected for Run.')
  }

  const candidate = singletonCandidate ?? externalCandidates[0] ?? runCandidates[0]

  if (!candidate) {
    throw new Error('Workflow requires at least one trigger block to execute')
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
