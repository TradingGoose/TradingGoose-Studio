import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { getBlock } from '@/blocks'
import type { QueuedWorkflowTriggerType } from '@/services/queue'
import { getTrigger } from '@/triggers'
import { resolveTriggerExecutionIdentity } from '@/triggers/resolution'
import type { TriggerConfig } from '@/triggers/types'
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
type WorkflowRunExecutionTriggerType = Extract<QueuedWorkflowTriggerType, 'chat' | 'manual'>

export type WorkflowRunTriggerOption = {
  id: string
  blockId: string
  name: string
  triggerSource: string
  icon?: TriggerConfig['icon']
  color: string
}

type WorkflowRunTriggerCandidate<T extends WorkflowRunTriggerBlock> = WorkflowRunTriggerOption & {
  block: T
  triggerType: QueuedWorkflowTriggerType
}

function getTriggerCandidates<T extends WorkflowRunTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>
): Array<WorkflowRunTriggerCandidate<T>> {
  return Object.entries(blocks).flatMap(([blockId, block]) => {
    if (!block?.type || block.enabled === false || !edges.some((edge) => edge.source === blockId)) {
      return []
    }

    try {
      const identity = resolveTriggerExecutionIdentity(block)
      const trigger = getTrigger(identity.triggerSource)
      if (!trigger) return []
      const blockConfig = getBlock(block.type)

      return [
        {
          id: `${blockId}:${identity.triggerSource}`,
          blockId,
          block,
          name: block.name || trigger.name,
          ...identity,
          icon: trigger.icon,
          color: sanitizeSolidIconColor(blockConfig?.bgColor) ?? '#6B7280',
        },
      ]
    } catch {
      return []
    }
  })
}

export function listWorkflowRunTriggers<T extends WorkflowRunTriggerBlock>(
  blocks: Record<string, T>,
  edges: Array<{ source: string; target: string }>
): WorkflowRunTriggerOption[] {
  return getTriggerCandidates(blocks, edges)
    .filter(({ triggerType }) => triggerType !== 'chat')
    .map(({ block, triggerType, ...trigger }) => trigger)
}

function materializeTriggerSource<T extends WorkflowRunTriggerBlock>(
  block: T,
  triggerSource: string
): T {
  const selectedTriggerId = block.subBlocks?.selectedTriggerId
  const nextSelectedTriggerId =
    selectedTriggerId && typeof selectedTriggerId === 'object' && !Array.isArray(selectedTriggerId)
      ? { ...selectedTriggerId, value: triggerSource }
      : { value: triggerSource }

  return {
    ...block,
    triggerMode: true,
    subBlocks: {
      ...(block.subBlocks ?? {}),
      selectedTriggerId: nextSelectedTriggerId,
    },
  }
}

function buildWorkflowRunTriggerInput(
  block: WorkflowRunTriggerBlock,
  workflowInput: unknown,
  options: { preserveProvidedInput: boolean }
): unknown {
  if (options.preserveProvidedInput && workflowInput !== undefined) {
    return workflowInput
  }

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
  blocks: Record<string, T>
  input: unknown
  triggerType: WorkflowRunExecutionTriggerType
} {
  const candidate = getTriggerCandidates(blocks, edges).find(
    (item) =>
      item.blockId === options.triggerBlockId &&
      (options.surface !== 'editor' || item.triggerType !== 'chat')
  )
  if (!candidate) {
    throw new Error(`Trigger block ${options.triggerBlockId} is not available for Run`)
  }

  const block = materializeTriggerSource(candidate.block, candidate.triggerSource)
  const isChatRun = candidate.triggerType === 'chat'

  return {
    blockId: candidate.blockId,
    blocks: { ...blocks, [candidate.blockId]: block },
    input: buildWorkflowRunTriggerInput(block, options.workflowInput, {
      preserveProvidedInput: options.surface === 'copilot' || isChatRun,
    }),
    triggerType: isChatRun ? 'chat' : 'manual',
  }
}
