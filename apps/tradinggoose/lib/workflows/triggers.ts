import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import type { QueuedWorkflowTriggerType } from '@/services/queue'
import { resolveTriggerExecutionIdentity } from '@/triggers/resolution'
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
  enabled?: boolean
  triggerMode?: boolean
  subBlocks?: Record<string, { value?: unknown }>
}

type WorkflowRunSurface = 'editor' | 'copilot'

type WorkflowRunTriggerCandidate<T extends WorkflowRunTriggerBlock> = {
  blockId: string
  block: T
  triggerSource: string
  triggerType: QueuedWorkflowTriggerType
}

export type WorkflowRunTriggerOption = {
  blockId: string
  name: string
  triggerSource: string
  triggerType: QueuedWorkflowTriggerType
}

function getTriggerName(blockId: string, block: WorkflowRunTriggerBlock) {
  return block.name || TriggerUtils.getDefaultTriggerName(block.type) || block.type || blockId
}

function getTriggerCandidates<T extends WorkflowRunTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>,
  surface: WorkflowRunSurface
) {
  return Object.entries(blocks).filter(([blockId, block]) => {
    if (!block?.type || block.enabled === false || !TriggerUtils.isTriggerBlock(block)) {
      return false
    }
    if (surface === 'editor' && block.type === TRIGGER_TYPES.CHAT) {
      return false
    }
    return edges.some((edge) => edge.source === blockId)
  })
}

function getRunnableTriggerCandidates<T extends WorkflowRunTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>,
  surface: WorkflowRunSurface
): Array<WorkflowRunTriggerCandidate<T>> {
  return getTriggerCandidates(blocks, edges, surface).flatMap(([blockId, block]) => {
    try {
      const identity = resolveTriggerExecutionIdentity(block)
      return [{ blockId, block, ...identity }]
    } catch {
      return []
    }
  })
}

export function listWorkflowRunTriggers<T extends WorkflowRunTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>,
  options: { surface: WorkflowRunSurface }
): WorkflowRunTriggerOption[] {
  return getRunnableTriggerCandidates(blocks, edges, options.surface).map(
    ({ blockId, block, triggerSource, triggerType }) => ({
      blockId,
      name: getTriggerName(blockId, block),
      triggerSource,
      triggerType,
    })
  )
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
    surface: WorkflowRunSurface
    workflowInput?: unknown
    triggerBlockId: string
  }
): {
  blockId: string
  input: unknown
  triggerType: QueuedWorkflowTriggerType
} {
  const isEditorRun = options.surface === 'editor'
  const triggerBlockId = options.triggerBlockId
  const triggerCandidates = getTriggerCandidates(blocks, edges, options.surface)

  if (isEditorRun && blocks[triggerBlockId]?.type === TRIGGER_TYPES.CHAT) {
    throw new Error('Chat Trigger blocks run from the chat widget, not editor Run')
  }

  const candidate = triggerCandidates.find(([blockId]) => blockId === triggerBlockId)
  if (!candidate) {
    throw new Error(`Trigger block ${triggerBlockId} is not available for Run`)
  }

  const [blockId, block] = candidate
  const identity = resolveTriggerExecutionIdentity(block)

  return {
    blockId,
    input: isEditorRun
      ? buildEditorTestTriggerInput(block, options.workflowInput)
      : options.workflowInput,
    triggerType: isEditorRun && identity.triggerType !== 'chat' ? 'manual' : identity.triggerType,
  }
}
