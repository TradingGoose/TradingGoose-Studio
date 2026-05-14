import type { Edge } from '@xyflow/react'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { createLogger } from '@/lib/logs/console/logger'
import { parseResponseFormatSafely } from '@/lib/response-format'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { buildConfiguredSubBlockParams } from '@/lib/workflows/subblock-values'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

const logger = createLogger('Serializer')

/**
 * Structured validation error for pre-execution workflow validation
 */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public blockId?: string,
    public blockType?: string,
    public blockName?: string
  ) {
    super(message)
    this.name = 'WorkflowValidationError'
  }
}

/**
 * Helper function to check if a subblock should be included in serialization based on current mode
 */
function shouldIncludeField(subBlockConfig: SubBlockConfig, isAdvancedMode: boolean): boolean {
  const fieldMode = subBlockConfig.mode

  if (fieldMode === 'advanced' && !isAdvancedMode) {
    return false // Skip advanced-only fields when in basic mode
  }

  return true
}

export class Serializer {
  serializeWorkflow(
    blocks: Record<string, BlockState>,
    edges: Edge[],
    loops: Record<string, Loop>,
    parallels?: Record<string, Parallel>,
    validateRequired = false
  ): SerializedWorkflow {
    const safeLoops = loops || {}
    const safeParallels = parallels || {}
    const accessibleBlocksMap = this.computeAccessibleBlockIds(
      blocks,
      edges,
      safeLoops,
      safeParallels
    )

    if (validateRequired) {
      this.validateSubflowsBeforeExecution(blocks, safeLoops, safeParallels)
    }

    return {
      version: '1.0',
      blocks: Object.values(blocks).map((block) =>
        this.serializeBlock(block, {
          validateRequired,
          allBlocks: blocks,
          accessibleBlocksMap,
        })
      ),
      connections: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
      })),
      loops: safeLoops,
      parallels: safeParallels,
    }
  }

  /**
   * Validate loop and parallel subflows for required inputs when running in "each/collection" modes
   */
  private validateSubflowsBeforeExecution(
    blocks: Record<string, BlockState>,
    loops: Record<string, Loop>,
    parallels: Record<string, Parallel>
  ): void {
    // Validate loops in forEach mode
    Object.values(loops || {}).forEach((loop) => {
      if (!loop) return
      if (loop.loopType === 'forEach') {
        const items = (loop as any).forEachItems

        const hasNonEmptyCollection = (() => {
          if (items === undefined || items === null) return false
          if (Array.isArray(items)) return items.length > 0
          if (typeof items === 'object') return Object.keys(items).length > 0
          if (typeof items === 'string') {
            const trimmed = items.trim()
            if (trimmed.length === 0) return false
            // If it looks like JSON, parse to confirm non-empty [] / {}
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed)
                if (Array.isArray(parsed)) return parsed.length > 0
                if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0
              } catch {
                // Non-JSON or invalid JSON string – allow non-empty string (could be a reference like <start.items>)
                return true
              }
            }
            // Non-JSON string – allow (may be a variable reference/expression)
            return true
          }
          return false
        })()

        if (!hasNonEmptyCollection) {
          const blockName = blocks[loop.id]?.name || 'Loop'
          const error = new WorkflowValidationError(
            `${blockName} requires a collection for forEach mode. Provide a non-empty array/object or a variable reference.`,
            loop.id,
            'loop',
            blockName
          )
          throw error
        }
      }
    })

    // Validate parallels in collection mode
    Object.values(parallels || {}).forEach((parallel) => {
      if (!parallel) return
      if ((parallel as any).parallelType === 'collection') {
        const distribution = (parallel as any).distribution

        const hasNonEmptyDistribution = (() => {
          if (distribution === undefined || distribution === null) return false
          if (Array.isArray(distribution)) return distribution.length > 0
          if (typeof distribution === 'object') return Object.keys(distribution).length > 0
          if (typeof distribution === 'string') {
            const trimmed = distribution.trim()
            if (trimmed.length === 0) return false
            // If it looks like JSON, parse to confirm non-empty [] / {}
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed)
                if (Array.isArray(parsed)) return parsed.length > 0
                if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0
              } catch {
                return true
              }
            }
            return true
          }
          return false
        })()

        if (!hasNonEmptyDistribution) {
          const blockName = blocks[parallel.id]?.name || 'Parallel'
          const error = new WorkflowValidationError(
            `${blockName} requires a collection for collection mode. Provide a non-empty array/object or a variable reference.`,
            parallel.id,
            'parallel',
            blockName
          )
          throw error
        }
      }
    })
  }

  private serializeBlock(
    block: BlockState,
    options: {
      validateRequired: boolean
      allBlocks: Record<string, BlockState>
      accessibleBlocksMap: Map<string, Set<string>>
    }
  ): SerializedBlock {
    // Special handling for subflow blocks (loops, parallels, etc.)
    if (block.type === 'loop' || block.type === 'parallel') {
      return {
        id: block.id,
        position: block.position,
        config: {
          tool: '', // Loop blocks don't have tools
          params: block.data || {}, // Preserve the block data (parallelType, count, etc.)
        },
        inputs: {},
        outputs: block.outputs,
        metadata: {
          id: block.type,
          name: block.name,
          description: block.type === 'loop' ? 'Loop container' : 'Parallel container',
          category: 'subflow',
          color: block.type === 'loop' ? '#3b82f6' : '#8b5cf6',
        },
        enabled: block.enabled,
      }
    }

    const blockConfig = getBlock(block.type)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${block.type}`)
    }

    // Extract parameters from UI state
    const params = this.extractParams(block)

    try {
      const isTriggerCategory = blockConfig.category === 'triggers'
      if (block.triggerMode === true || isTriggerCategory) {
        params.triggerMode = true
      }
      if (block.advancedMode === true) {
        params.advancedMode = true
      }
    } catch (_) {
      // no-op: conservative, avoid blocking serialization if blockConfig is unexpected
    }

    // Validate required fields that only users can provide (before execution starts)
    if (options.validateRequired) {
      this.validateRequiredFieldsBeforeExecution(block, blockConfig, params)
    }

    let toolId = ''

    if (block.type === 'agent' && params.tools) {
      // Process the tools in the agent block
      try {
        const tools = Array.isArray(params.tools) ? params.tools : JSON.parse(params.tools)

        // If there are custom tools, we just keep them as is
        // They'll be handled by the executor during runtime

        // For non-custom tools, we determine the tool ID
        const nonCustomTools = tools.filter((tool: any) => tool.type !== 'custom-tool')
        if (nonCustomTools.length > 0) {
          try {
            toolId = blockConfig.tools.config?.tool
              ? blockConfig.tools.config.tool(params)
              : blockConfig.tools.access[0]
          } catch (error) {
            logger.warn('Tool selection failed during serialization, using default:', {
              error: error instanceof Error ? error.message : String(error),
            })
            toolId = blockConfig.tools.access[0]
          }
        }
      } catch (error) {
        logger.error('Error processing tools in agent block:', { error })
        // Default to the first tool if we can't process tools
        toolId = blockConfig.tools.access[0]
      }
    } else {
      // For non-agent blocks, get tool ID from block config as usual
      try {
        toolId = blockConfig.tools.config?.tool
          ? blockConfig.tools.config.tool(params)
          : blockConfig.tools.access[0]
      } catch (error) {
        logger.warn('Tool selection failed during serialization, using default:', {
          error: error instanceof Error ? error.message : String(error),
        })
        toolId = blockConfig.tools.access[0]
      }
    }

    // Get inputs from block config
    const inputs: Record<string, any> = {}
    if (blockConfig.inputs) {
      Object.entries(blockConfig.inputs).forEach(([key, config]) => {
        inputs[key] = config.type
      })
    }
    const responseFormat = params.responseFormat
      ? parseResponseFormatSafely(params.responseFormat, block.id)
      : null

    return {
      id: block.id,
      position: block.position,
      config: {
        tool: toolId,
        params,
      },
      inputs,
      outputs: {
        ...block.outputs,
        ...(responseFormat ? { responseFormat } : {}),
      },
      metadata: {
        id: block.type,
        name: block.name,
        description: blockConfig.description,
        category: blockConfig.category,
        color: sanitizeSolidIconColor(blockConfig.bgColor),
      },
      enabled: block.enabled,
    }
  }

  private extractParams(block: BlockState): Record<string, any> {
    // Special handling for subflow blocks (loops, parallels, etc.)
    if (block.type === 'loop' || block.type === 'parallel') {
      return {} // Loop and parallel blocks don't have traditional params
    }

    const blockConfig = getBlock(block.type)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${block.type}`)
    }

    const isAdvancedMode = block.advancedMode ?? false
    const params = buildConfiguredSubBlockParams({
      blockId: block.id,
      subBlockConfigs: blockConfig.subBlocks,
      subBlocks: block.subBlocks,
      isAdvancedMode,
    })

    blockConfig.subBlocks.forEach((subBlockConfig) => {
      const paramId = subBlockConfig.canonicalParamId ?? subBlockConfig.id
      if (
        (params[paramId] === null || params[paramId] === undefined) &&
        subBlockConfig.value &&
        shouldIncludeField(subBlockConfig, isAdvancedMode)
      ) {
        params[paramId] = subBlockConfig.value(params)
      }
    })

    return params
  }

  private validateRequiredFieldsBeforeExecution(
    block: BlockState,
    blockConfig: any,
    params: Record<string, any>
  ) {
    // Skip validation if the block is used as a trigger
    if (
      block.triggerMode === true ||
      blockConfig.category === 'triggers' ||
      params.triggerMode === true
    ) {
      logger.info('Skipping validation for block in trigger mode', {
        blockId: block.id,
        blockType: block.type,
      })
      return
    }

    const missingFields: string[] = []
    const missingParamIds = new Set<string>()

    blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
      if (subBlockConfig.hidden) return
      if (!shouldIncludeField(subBlockConfig, block.advancedMode ?? false)) return
      if (!evaluateSubBlockConditionValues(subBlockConfig.condition, params)) return

      const paramId = subBlockConfig.canonicalParamId ?? subBlockConfig.id
      const paramConfig = blockConfig.inputs?.[paramId] ?? blockConfig.inputs?.[subBlockConfig.id]
      if (
        paramConfig?.visibility !== 'user-only' ||
        paramConfig.required !== true ||
        missingParamIds.has(paramId)
      ) {
        return
      }

      const isRequired =
        subBlockConfig.required === undefined ||
        subBlockConfig.required === true ||
        (typeof subBlockConfig.required === 'object' &&
          evaluateSubBlockConditionValues(subBlockConfig.required, params)) ||
        (typeof subBlockConfig.required === 'function' &&
          evaluateSubBlockConditionValues(subBlockConfig.required, params))
      if (!isRequired) return

      const fieldValue = params[paramId]
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        missingParamIds.add(paramId)
        missingFields.push(subBlockConfig.title || subBlockConfig.id)
      }
    })

    if (missingFields.length > 0) {
      const blockName = block.name || blockConfig.name || 'Block'
      throw new Error(`${blockName} is missing required fields: ${missingFields.join(', ')}`)
    }
  }

  private computeAccessibleBlockIds(
    blocks: Record<string, BlockState>,
    edges: Edge[],
    loops: Record<string, Loop>,
    parallels: Record<string, Parallel>
  ): Map<string, Set<string>> {
    const accessibleMap = new Map<string, Set<string>>()
    const simplifiedEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }))

    Object.keys(blocks).forEach((blockId) => {
      const ancestorIds = BlockPathCalculator.findAllPathNodes(simplifiedEdges, blockId)
      const accessibleIds = new Set<string>(ancestorIds)
      accessibleIds.add(blockId)

      Object.values(loops).forEach((loop) => {
        if (!loop?.nodes) return
        if (loop.nodes.includes(blockId)) {
          loop.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
        }
      })

      Object.values(parallels).forEach((parallel) => {
        if (!parallel?.nodes) return
        if (parallel.nodes.includes(blockId)) {
          parallel.nodes.forEach((nodeId) => accessibleIds.add(nodeId))
        }
      })

      accessibleMap.set(blockId, accessibleIds)
    })

    return accessibleMap
  }

  deserializeWorkflow(workflow: SerializedWorkflow): {
    blocks: Record<string, BlockState>
    edges: Edge[]
  } {
    const blocks: Record<string, BlockState> = {}
    const edges: Edge[] = []

    // Deserialize blocks
    workflow.blocks.forEach((serializedBlock) => {
      const block = this.deserializeBlock(serializedBlock)
      blocks[block.id] = block
    })

    // Deserialize connections
    workflow.connections.forEach((connection) => {
      edges.push({
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      })
    })

    return { blocks, edges }
  }

  private deserializeBlock(serializedBlock: SerializedBlock): BlockState {
    const blockType = serializedBlock.metadata?.id
    if (!blockType) {
      throw new Error(`Invalid block type: ${serializedBlock.metadata?.id}`)
    }

    // Special handling for subflow blocks (loops, parallels, etc.)
    if (blockType === 'loop' || blockType === 'parallel') {
      return {
        id: serializedBlock.id,
        type: blockType,
        name: serializedBlock.metadata?.name || (blockType === 'loop' ? 'Loop' : 'Parallel'),
        position: serializedBlock.position,
        subBlocks: {}, // Loops and parallels don't have traditional subBlocks
        outputs: serializedBlock.outputs,
        enabled: serializedBlock.enabled ?? true,
        data: serializedBlock.config.params, // Preserve the data (parallelType, count, etc.)
      }
    }

    const blockConfig = getBlock(blockType)
    if (!blockConfig) {
      throw new Error(`Invalid block type: ${blockType}`)
    }

    const subBlocks: Record<string, any> = {}
    blockConfig.subBlocks.forEach((subBlock) => {
      const paramId = subBlock.canonicalParamId ?? subBlock.id
      subBlocks[subBlock.id] = {
        id: subBlock.id,
        type: subBlock.type,
        value: serializedBlock.config.params[paramId] ?? null,
      }
    })

    return {
      id: serializedBlock.id,
      type: blockType,
      name: serializedBlock.metadata?.name || blockConfig.name,
      position: serializedBlock.position,
      subBlocks,
      outputs: serializedBlock.outputs,
      enabled: serializedBlock.enabled ?? true,
      triggerMode:
        serializedBlock.config?.params?.triggerMode === true ||
        serializedBlock.metadata?.category === 'triggers',
      advancedMode: serializedBlock.config?.params?.advancedMode === true,
    }
  }
}
