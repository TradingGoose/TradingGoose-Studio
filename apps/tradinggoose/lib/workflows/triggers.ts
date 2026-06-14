import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import type { QueuedWorkflowTriggerType } from '@/services/queue'
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

  static findTriggerBlock<T extends { type: string; subBlocks?: any }>(
    blocks: Record<string, T>,
    executionType: 'chat' | 'manual' | 'api',
    isChildWorkflow = false
  ): { blockId: string; block: T } | null {
    const entry = Object.entries(blocks).find(([, block]) => {
      if (executionType === 'chat') return block.type === TRIGGER_TYPES.CHAT
      if (executionType === 'manual') {
        return block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.MANUAL
      }
      return isChildWorkflow ? block.type === TRIGGER_TYPES.INPUT : block.type === TRIGGER_TYPES.API
    })

    return entry ? { blockId: entry[0], block: entry[1] } : null
  }

  static wouldViolateSingleInstance<T extends { type: string }>(
    blocks: T[] | Record<string, T>,
    triggerType: string
  ): boolean {
    if (
      triggerType !== TRIGGER_TYPES.API &&
      triggerType !== TRIGGER_TYPES.INPUT &&
      triggerType !== TRIGGER_TYPES.MANUAL &&
      triggerType !== TRIGGER_TYPES.CHAT
    ) {
      return false
    }

    const blockArray = Array.isArray(blocks) ? blocks : Object.values(blocks)
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

export type WorkflowRunTriggerBlock = {
  type: string
  name?: string
  triggerMode?: boolean
  subBlocks?: Record<string, { value?: unknown }>
}

function buildEditorTestTriggerInput(
  block: WorkflowRunTriggerBlock,
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

export function resolveWorkflowRunTrigger<T extends WorkflowRunTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>,
  options: {
    surface: 'editor' | 'copilot'
    workflowInput?: unknown
    selectedBlockId?: string | null
  }
): {
  blockId: string
  input: unknown
  triggerType: QueuedWorkflowTriggerType
} {
  const isEditorRun = options.surface === 'editor'
  const selectedBlockId = options.selectedBlockId
  const triggerCandidates = Object.entries(blocks).filter(([, block]) =>
    TriggerUtils.isTriggerBlock(block)
  )
  const isConnected = ([blockId]: [string, T]) => edges.some((edge) => edge.source === blockId)
  const isRunnable = ([, block]: [string, T]) => resolveTriggerIdForBlock(block) !== null

  const selectedTriggerCandidate = triggerCandidates.find(
    ([blockId]) => blockId === selectedBlockId
  )
  if (isEditorRun && selectedTriggerCandidate?.[1].type === TRIGGER_TYPES.CHAT) {
    throw new Error('Chat Trigger blocks run from the chat widget, not editor Run')
  }

  const candidates = isEditorRun
    ? triggerCandidates.filter(([, block]) => block.type !== TRIGGER_TYPES.CHAT)
    : triggerCandidates
  const selectedCandidate = candidates.find(([blockId]) => blockId === selectedBlockId)
  const connectedCandidates = candidates.filter(isConnected)
  const selectionCandidates = connectedCandidates.length > 0 ? connectedCandidates : candidates
  const runnableCandidates = selectionCandidates.filter(isRunnable)
  let candidate: [string, T] | undefined = selectedCandidate

  if (isEditorRun && selectedBlockId && !candidate) {
    const selectedPathNodes = new Set(BlockPathCalculator.findAllPathNodes(edges, selectedBlockId))
    const pathCandidates = runnableCandidates.filter(([blockId]) => selectedPathNodes.has(blockId))
    const unconfiguredPathCandidate = selectionCandidates.find(([blockId]) =>
      selectedPathNodes.has(blockId)
    )
    const pathHasChatTrigger = triggerCandidates.some(
      ([blockId, block]) => block.type === TRIGGER_TYPES.CHAT && selectedPathNodes.has(blockId)
    )

    if (pathHasChatTrigger && !unconfiguredPathCandidate) {
      throw new Error('Chat Trigger blocks run from the chat widget, not editor Run')
    }
    if (pathCandidates.length > 1) {
      throw new Error(
        'Multiple trigger blocks found. Select one trigger block or a block on one trigger branch for Run.'
      )
    }

    candidate = pathCandidates[0] ?? unconfiguredPathCandidate
    if (!candidate) {
      throw new Error('Selected block is not on a non-chat trigger branch for Run')
    }
  } else if (isEditorRun) {
    if (runnableCandidates.length > 1) {
      throw new Error(
        'Multiple trigger blocks found. Select one trigger block or a block on one trigger branch for Run.'
      )
    }
    candidate =
      runnableCandidates[0] ??
      (selectionCandidates.length === 1 ? selectionCandidates[0] : undefined)
  } else if (!candidate) {
    candidate =
      runnableCandidates.find(([, block]) => block.type === TRIGGER_TYPES.CHAT) ??
      runnableCandidates.find(
        ([, block]) => block.type === TRIGGER_TYPES.INPUT || block.type === TRIGGER_TYPES.MANUAL
      ) ??
      runnableCandidates.find(([, block]) => block.type === TRIGGER_TYPES.API) ??
      (runnableCandidates.length === 1 ? runnableCandidates[0] : undefined) ??
      (selectionCandidates.length === 1 ? selectionCandidates[0] : undefined)
  }

  if (!candidate) {
    throw new Error(
      isEditorRun
        ? 'Run requires a connected non-chat trigger block'
        : 'Copilot run_workflow requires a single connected runnable trigger block.'
    )
  }

  const [blockId, block] = candidate
  const identity = resolveTriggerExecutionIdentity(block)
  if (!edges.some((edge) => edge.source === blockId)) {
    const triggerName = block.name || TriggerUtils.getDefaultTriggerName(block.type) || block.type
    throw new Error(`${triggerName} must be connected to other blocks to execute`)
  }

  return {
    blockId,
    input: isEditorRun
      ? buildEditorTestTriggerInput(block, options.workflowInput)
      : options.workflowInput,
    triggerType: isEditorRun && identity.triggerType !== 'chat' ? 'manual' : identity.triggerType,
  }
}
