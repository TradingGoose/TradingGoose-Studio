import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'

export function getAllowedSubBlockIds(subBlocks: SubBlockConfig[]): Set<string> {
  const allowedIds = new Set<string>()

  for (const subBlock of subBlocks) {
    allowedIds.add(subBlock.id)

    if (subBlock.type === 'checkbox-list' || subBlock.type === 'grouped-checkbox-list') {
      const options = typeof subBlock.options === 'function' ? subBlock.options() : subBlock.options
      if (Array.isArray(options)) {
        for (const option of options) {
          if (typeof option?.id === 'string' && option.id.trim().length > 0) {
            allowedIds.add(option.id)
          }
        }
      }
    }

    if (subBlock.type === 'code') {
      allowedIds.add(`${subBlock.id}_collapsed`)
    }
  }

  return allowedIds
}

function stringifyComparableValue(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function findIntroducedNonCanonicalSubBlocks(
  workflowState: WorkflowSnapshot,
  baseWorkflowState?: WorkflowSnapshot
): string[] {
  if (!workflowState?.blocks || typeof workflowState.blocks !== 'object') {
    return []
  }

  const errors: string[] = []

  for (const [blockId, block] of Object.entries(workflowState.blocks)) {
    const blockConfig = getBlock(block.type)
    if (!blockConfig || !block.subBlocks || typeof block.subBlocks !== 'object') {
      continue
    }

    const allowedSubBlockIds = getAllowedSubBlockIds(blockConfig.subBlocks)
    const baseSubBlocks = baseWorkflowState?.blocks?.[blockId]?.subBlocks ?? {}

    for (const [subBlockId, subBlock] of Object.entries(block.subBlocks)) {
      if (allowedSubBlockIds.has(subBlockId)) {
        continue
      }

      const baseSubBlock = baseSubBlocks[subBlockId]
      if (
        baseSubBlock &&
        stringifyComparableValue(baseSubBlock) === stringifyComparableValue(subBlock)
      ) {
        continue
      }

      errors.push(
        `Block ${block.name || blockId}: non-canonical sub-block "${subBlockId}" is not part of the ${block.type} block config. Use the canonical sub-block ids: ${[...allowedSubBlockIds].sort().join(', ')}.`
      )
    }
  }

  return errors
}
