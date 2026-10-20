import {
  getCustomToolEntityIdFromRuntimeId,
  isCustomToolRuntimeId,
} from '@/lib/custom-tools/schema'
import { createLogger } from '@/lib/logs/console/logger'
import { extractEnvironmentReferences, extractReferencePrefixes } from '@/lib/workflows/references'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { buildConfiguredSubBlockParams, isSubBlockInMode } from '@/lib/workflows/subblock-values'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { getTool } from '@/tools/utils'

const logger = createLogger('WorkflowValidation')

function isValidAgentCustomTool(tool: any): boolean {
  try {
    if (!tool || typeof tool !== 'object') return false
    if (tool.type !== 'custom-tool') return false
    getCustomToolEntityIdFromRuntimeId(tool.toolId)

    const schema = tool.schema
    if (!schema || typeof schema !== 'object') return false
    const fn = schema.function
    if (!fn || typeof fn !== 'object') return false

    const params = fn.parameters
    if (!params || typeof params !== 'object') return false
    if (params.type !== 'object') return false
    if (!params.properties || typeof params.properties !== 'object') return false

    return true
  } catch (_err) {
    return false
  }
}

export function sanitizeAgentToolsInBlocks(blocks: Record<string, any>): {
  blocks: Record<string, any>
  warnings: string[]
} {
  const toolSanitizationWarnings: string[] = []

  // Shallow clone to avoid mutating callers
  const sanitizedBlocks: Record<string, any> = { ...blocks }

  for (const [blockId, block] of Object.entries(sanitizedBlocks)) {
    try {
      if (!block || block.type !== 'agent') continue
      const subBlocks = block.subBlocks || {}
      const toolsSubBlock = subBlocks.tools
      if (!toolsSubBlock) continue

      const value = toolsSubBlock.value

      if (!Array.isArray(value)) {
        toolSanitizationWarnings.push(
          `Block ${block.name || blockId}: tools value is not an array; resetting`
        )
        toolsSubBlock.value = []
        continue
      }

      const originalLength = value.length
      const cleaned = value
        .filter((tool: any) => {
          // Allow non-custom tools to pass through as-is
          if (!tool || typeof tool !== 'object') return false
          if (tool.type !== 'custom-tool') return true
          const ok = isValidAgentCustomTool(tool)
          if (!ok) {
            logger.warn('Removing invalid custom tool from workflow', {
              blockId,
              blockName: block.name,
            })
          }
          return ok
        })
        .map((tool: any) => {
          if (tool.type === 'custom-tool') {
            // Ensure required defaults to avoid client crashes
            if (!tool.code || typeof tool.code !== 'string') {
              tool.code = ''
            }
            if (!tool.usageControl) {
              tool.usageControl = 'auto'
            }
          }
          return tool
        })

      if (cleaned.length !== originalLength) {
        toolSanitizationWarnings.push(
          `Block ${block.name || blockId}: removed ${originalLength - cleaned.length} invalid tool(s)`
        )
      }

      toolsSubBlock.value = cleaned
      // Reassign in case caller uses object identity
      sanitizedBlocks[blockId] = { ...block, subBlocks: { ...subBlocks, tools: toolsSubBlock } }
    } catch (cause) {
      logger.error('Workflow agent tool sanitation failed', { blockId }, cause)
      toolSanitizationWarnings.push(`Block ${blockId}: tools sanitation could not be completed.`)
    }
  }

  return { blocks: sanitizedBlocks, warnings: toolSanitizationWarnings }
}

export interface WorkflowValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  sanitizedState?: WorkflowState
}

function validateSubBlockValues(block: BlockState, blockConfig: BlockConfig): string[] {
  const errors: string[] = []
  const isAdvancedMode = block.advancedMode ?? false
  const isPureTriggerBlock = blockConfig.category === 'triggers'
  const isTriggerMode = block.triggerMode === true || isPureTriggerBlock
  const params = buildConfiguredSubBlockParams({
    blockId: block.id,
    subBlockConfigs: blockConfig.subBlocks,
    subBlocks: block.subBlocks,
    isAdvancedMode,
  })

  for (const config of blockConfig.subBlocks) {
    if (!isSubBlockInMode(config, isAdvancedMode)) continue
    if (
      isTriggerMode
        ? config.mode !== 'trigger' && (!isPureTriggerBlock || !!config.mode)
        : config.mode === 'trigger'
    ) {
      continue
    }
    if (!evaluateSubBlockConditionValues(config.condition, params)) continue

    const value = block.subBlocks?.[config.id]?.value
    if (value === undefined || value === '') continue
    if (
      config.supportsReferences !== false &&
      typeof value === 'string' &&
      (extractReferencePrefixes(value).length > 0 || extractEnvironmentReferences(value).length > 0)
    ) {
      continue
    }

    const inputType = blockConfig.inputs[config.canonicalParamId ?? config.id]?.type
    const literalValue =
      inputType === 'number' && typeof value === 'string'
        ? Number(value)
        : inputType === 'boolean' && typeof value === 'boolean'
          ? String(value)
          : value
    let issue: string | undefined
    if (inputType === 'number' && (config.inputType === 'number' || config.type === 'slider')) {
      if (
        typeof literalValue !== 'number' ||
        !Number.isFinite(literalValue) ||
        (config.integer && !Number.isInteger(literalValue))
      ) {
        issue = config.integer ? 'Expected an integer.' : 'Expected a finite number.'
      } else if (config.min !== undefined && literalValue < config.min) {
        issue = `Expected a number greater than or equal to ${config.min}.`
      } else if (config.max !== undefined && literalValue > config.max) {
        issue = `Expected a number less than or equal to ${config.max}.`
      }
    } else if (
      config.type === 'dropdown' &&
      Array.isArray(config.options) &&
      config.options.length > 0
    ) {
      if (
        !config.options.some(
          (option) => (inputType === 'number' ? Number(option.id) : option.id) === literalValue
        )
      ) {
        issue = `Expected one of: ${config.options.map((option) => option.id).join(', ')}.`
      }
    } else if (
      config.type === 'long-input' &&
      inputType === 'string' &&
      typeof value !== 'string'
    ) {
      issue = 'Expected a string.'
    }

    if (issue) {
      errors.push(
        `Document contract is inconsistent: invalid block sub-block values for ${config.id} (${issue})`
      )
    }
  }
  return errors
}

/**
 * Comprehensive workflow state validation
 * Checks all tool references, block types, and required fields
 */
export function validateWorkflowState(
  workflowState: WorkflowState,
  options: { sanitize?: boolean } = {}
): WorkflowValidationResult {
  const workflowIssues: string[] = []
  const workflowWarnings: string[] = []
  let sanitizedState = workflowState

  try {
    // Basic structure validation
    if (!workflowState || typeof workflowState !== 'object') {
      workflowIssues.push('Invalid workflow state: must be an object')
      return { valid: false, errors: workflowIssues, warnings: workflowWarnings }
    }

    if (!workflowState.blocks || typeof workflowState.blocks !== 'object') {
      workflowIssues.push('Invalid workflow state: missing blocks')
      return { valid: false, errors: workflowIssues, warnings: workflowWarnings }
    }

    // Validate each block
    const sanitizedBlocks: Record<string, any> = {}
    let hasChanges = false

    for (const [blockId, block] of Object.entries(workflowState.blocks)) {
      if (!block || typeof block !== 'object') {
        workflowIssues.push(`Block ${blockId}: invalid block structure`)
        continue
      }

      // Check if block type exists
      const blockConfig = getBlock(block.type)

      if (!blockConfig) {
        workflowIssues.push(`Block ${block.name || blockId}: unknown block type '${block.type}'`)
        if (options.sanitize) {
          hasChanges = true
          continue // Skip this block in sanitized output
        }
      }

      if (blockConfig) {
        workflowIssues.push(...validateSubBlockValues(block, blockConfig))
      }

      // Validate tool references in blocks that use tools
      if (block.type === 'api' || block.type === 'generic') {
        // For API and generic blocks, the tool is determined by the block's tool configuration
        if (blockConfig?.tools?.access) {
          // API block has static tool access
          const toolIds = blockConfig.tools.access
          for (const toolId of toolIds) {
            const toolReferenceIssue = validateToolReference(toolId, block.type, block.name)
            if (toolReferenceIssue) {
              workflowIssues.push(toolReferenceIssue)
            }
          }
        }
      }

      // Special validation for agent blocks
      if (block.type === 'agent' && block.subBlocks?.tools?.value) {
        const toolsSanitization = sanitizeAgentToolsInBlocks({ [blockId]: block })
        workflowWarnings.push(...toolsSanitization.warnings)
        if (toolsSanitization.warnings.length > 0) {
          sanitizedBlocks[blockId] = toolsSanitization.blocks[blockId]
          hasChanges = true
        } else {
          sanitizedBlocks[blockId] = block
        }
      } else {
        sanitizedBlocks[blockId] = block
      }
    }

    // Validate edges reference existing blocks
    if (workflowState.edges && Array.isArray(workflowState.edges)) {
      const blockIds = new Set(Object.keys(sanitizedBlocks))

      for (const edge of workflowState.edges) {
        if (!edge || typeof edge !== 'object') {
          workflowIssues.push('Invalid edge structure')
          continue
        }

        if (!blockIds.has(edge.source)) {
          workflowIssues.push(`Edge references non-existent source block '${edge.source}'`)
        }
        if (!blockIds.has(edge.target)) {
          workflowIssues.push(`Edge references non-existent target block '${edge.target}'`)
        }
      }
    }

    // If we made changes during sanitization, create a new state object
    if (hasChanges && options.sanitize) {
      sanitizedState = {
        ...workflowState,
        blocks: sanitizedBlocks,
      }
    }

    const valid = workflowIssues.length === 0
    if (valid && options.sanitize) {
      sanitizedState = {
        ...sanitizedState,
        loops: generateLoopBlocks(sanitizedState.blocks),
        parallels: generateParallelBlocks(sanitizedState.blocks),
      }
    }
    return {
      valid,
      errors: workflowIssues,
      warnings: workflowWarnings,
      sanitizedState: options.sanitize ? sanitizedState : undefined,
    }
  } catch (cause) {
    logger.error('Workflow validation failed with exception', cause)
    workflowIssues.push('Workflow validation could not be completed.')
    return { valid: false, errors: workflowIssues, warnings: workflowWarnings }
  }
}

/**
 * Validate tool reference for a specific block
 * Returns null if valid, error message if invalid
 */
export function validateToolReference(
  toolId: string | undefined,
  blockType: string,
  blockName?: string
): string | null {
  if (!toolId) return null

  // Check if it's a custom tool or MCP tool
  const isCustomTool = isCustomToolRuntimeId(toolId)
  const isMcpTool = toolId.startsWith('mcp-')

  if (!isCustomTool && !isMcpTool) {
    // For built-in tools, verify they exist
    const tool = getTool(toolId)
    if (!tool) {
      return `Block ${blockName || 'unknown'} (${blockType}): references non-existent tool '${toolId}'`
    }
  }

  return null
}
