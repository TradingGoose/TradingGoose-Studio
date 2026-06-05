import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { getAllBlocks } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'

export interface TriggerInfo {
  id: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  category: 'core' | 'integration'
  enableTriggerMode?: boolean
}

/**
 * Get all blocks that can act as triggers
 * This includes both dedicated trigger blocks and tools with trigger capabilities
 */
export function getAllTriggerBlocks(): TriggerInfo[] {
  const allBlocks = getAllBlocks()
  const triggers: TriggerInfo[] = []

  for (const block of allBlocks) {
    // Skip hidden blocks
    if (block.hideFromToolbar) continue

    // Check if it's a core trigger block (category: 'triggers')
    if (block.category === 'triggers') {
      const color = sanitizeSolidIconColor(block.bgColor) ?? '#6B7280'
      triggers.push({
        id: block.type,
        icon: block.icon,
        color,
        category: 'core',
        enableTriggerMode: hasTriggerCapability(block),
      })
    }
    // Check if it's a tool with trigger capability
    else if (hasTriggerCapability(block)) {
      const color = sanitizeSolidIconColor(block.bgColor) ?? '#6B7280'
      triggers.push({
        id: block.type,
        icon: block.icon,
        color,
        category: 'integration',
        enableTriggerMode: true,
      })
    }
  }

  return triggers
}

/**
 * Check if a block has trigger capability (contains trigger-mode subblocks)
 */
export function hasTriggerCapability(block: BlockConfig): boolean {
  const hasTriggerModeSubBlocks = block.subBlocks.some((subBlock) => subBlock.mode === 'trigger')

  if (block.category === 'triggers') {
    return hasTriggerModeSubBlocks
  }

  return (
    (block.triggers?.enabled === true && block.triggers.available.length > 0) ||
    hasTriggerModeSubBlocks
  )
}

/**
 * Get blocks that should appear in the triggers tab
 * This includes all trigger blocks and tools with trigger mode
 */
export function getTriggersForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks()
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false
    // Include blocks with triggers category or trigger capability
    return block.category === 'triggers' || hasTriggerCapability(block)
  })
}

/**
 * Get blocks that should appear in the blocks tab
 * This excludes only dedicated trigger blocks, not tools with trigger capability
 */
export function getBlocksForSidebar(): BlockConfig[] {
  const allBlocks = getAllBlocks()
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false
    // Only exclude blocks with 'triggers' category
    // Tools with trigger capability should still appear in blocks tab
    return block.category !== 'triggers'
  })
}
