import { getBlock } from '@/blocks'

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
   * Check if a block is a specific trigger type
   */
  static isTriggerType(block: { type: string }, triggerType: TriggerType): boolean {
    return block.type === triggerType
  }

  /**
   * Check if a type string is any trigger type
   */
  static isAnyTriggerType(type: string): boolean {
    return Object.values(TRIGGER_TYPES).includes(type as TriggerType)
  }

  /**
   * Check if a block is a chat-compatible trigger
   */
  static isChatTrigger(block: { type: string; subBlocks?: any }): boolean {
    return block.type === TRIGGER_TYPES.CHAT
  }

  /**
   * Check if a block is a manual-compatible trigger
   */
  static isManualTrigger(block: { type: string; subBlocks?: any }): boolean {
    return block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.MANUAL
  }

  /**
   * Check if a block is an API-compatible trigger
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
    // Use the block's actual name from the registry
    const block = getBlock(triggerType)
    if (block) {
      // Special case for generic_webhook - show as "Webhook" in UI
      if (triggerType === 'generic_webhook') {
        return 'Webhook'
      }
      return block.name
    }

    // Fallback for legacy or unknown types
    switch (triggerType) {
      case TRIGGER_TYPES.CHAT:
        return 'Chat'
      case TRIGGER_TYPES.INPUT:
        return 'Input Trigger'
      case TRIGGER_TYPES.MANUAL:
        return 'Manual'
      case TRIGGER_TYPES.API:
        return 'API'
      case TRIGGER_TYPES.WEBHOOK:
        return 'Webhook'
      case TRIGGER_TYPES.SCHEDULE:
        return 'Schedule'
      default:
        return null
    }
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
   * Check if multiple triggers of a restricted type exist
   */
  static hasMultipleTriggers<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: TriggerType
  ): boolean {
    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
    const count = blockArray.filter((block) => block.type === triggerType).length
    return count > 1
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

  /**
   * Get trigger validation message
   */
  static getTriggerValidationMessage(
    triggerType: 'chat' | 'manual' | 'api',
    issue: 'missing' | 'multiple'
  ): string {
    const triggerName = triggerType.charAt(0).toUpperCase() + triggerType.slice(1)

    if (issue === 'missing') {
      return `${triggerName} execution requires a ${triggerName} Trigger block`
    }

    return `Multiple ${triggerName} Trigger blocks found. Keep only one.`
  }
}
