import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { VariableManager } from '@/lib/variables/variable-manager'
import {
  extractEnvironmentReferences,
  extractReferencePrefixes,
  getLoopContextId,
  isEnvironmentReference,
  SYSTEM_REFERENCE_PREFIXES,
} from '@/lib/workflows/references'
import { evaluateSubBlockCondition } from '@/lib/workflows/sub-block-conditions'
import { getBlock } from '@/blocks/index'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { VariableType } from '@/stores/variables/types'
import { normalizeBlockName } from '@/stores/workflows/utils'

const logger = createLogger('InputResolver')
const UNRESOLVED_REFERENCE = Symbol('unresolvedReference')

interface ReferenceContext {
  native?: boolean
  json?: boolean
}

const isInsideJsonString = (value: string, position: number): boolean => {
  let inString = false
  for (let index = 0; index < position; index++) {
    if (value[index] === '\\') index++
    else if (value[index] === '"') inString = !inString
  }
  return inString
}

export class InputResolver {
  private blockById: Map<string, SerializedBlock>
  private blockByNormalizedName: Map<string, SerializedBlock>
  private loopsByBlockId: Map<string, string> // Maps block ID to containing loop ID
  private parallelsByBlockId: Map<string, string> // Maps block ID to containing parallel ID

  constructor(
    private workflow: SerializedWorkflow,
    private environmentVariables: Record<string, string>,
    private workflowVariables: Record<string, any>,
    public accessibleBlocksMap: Map<string, Set<string>>
  ) {
    // Create maps for efficient lookups
    this.blockById = new Map(workflow.blocks.map((block) => [block.id, block]))

    // Initialize the normalized name map
    this.blockByNormalizedName = new Map(
      workflow.blocks.map((block) => [
        block.metadata?.name ? normalizeBlockName(block.metadata.name) : block.id,
        block,
      ])
    )

    // Create efficient loop lookup map
    this.loopsByBlockId = new Map()
    for (const [loopId, loop] of Object.entries(workflow.loops || {})) {
      for (const blockId of loop.nodes) {
        this.loopsByBlockId.set(blockId, loopId)
      }
    }

    // Create efficient parallel lookup map
    this.parallelsByBlockId = new Map()
    for (const [parallelId, parallel] of Object.entries(workflow.parallels || {})) {
      for (const blockId of parallel.nodes) {
        this.parallelsByBlockId.set(blockId, parallelId)
      }
    }
  }

  /** Resolves condition controllers before processing their active dependent inputs. */
  resolveInputs(block: SerializedBlock, context: ExecutionContext): Record<string, any> {
    const inputs = { ...block.config.params }
    const subBlocks = block.metadata?.id ? (getBlock(block.metadata.id)?.subBlocks ?? []) : []
    const result: Record<string, any> = {}
    const resolved = new Map<string, unknown>()
    const resolving = new Set<string>()

    const resolveField = (key: string): unknown => {
      if (!Object.hasOwn(inputs, key)) return undefined
      if (resolved.has(key)) return resolved.get(key)
      if (resolving.has(key)) {
        throw new Error(`Circular input condition dependency: ${[...resolving, key].join(' -> ')}`)
      }
      resolving.add(key)
      try {
        const matchingSubBlocks = subBlocks.filter((subBlock) => subBlock.id === key)
        let value: unknown
        if (
          !matchingSubBlocks.length ||
          matchingSubBlocks.some((subBlock) =>
            evaluateSubBlockCondition(subBlock.condition, resolveField)
          )
        ) {
          value = this.resolveInputValue(key, inputs[key], block, context)
          result[key] = value
        }
        resolved.set(key, value)
        return value
      } finally {
        resolving.delete(key)
      }
    }

    Object.keys(inputs).forEach(resolveField)
    return result
  }

  private resolveInputValue(
    key: string,
    value: any,
    block: SerializedBlock,
    context: ExecutionContext
  ): any {
    // Resolve notifications after persistence, when this block's review URL exists.
    if (block.metadata?.id === 'human_in_the_loop' && key === 'notification') return value
    if (block.metadata?.id === 'condition' && key === 'conditions') return value
    if (value === null || value === undefined) return value

    if (typeof value === 'string') {
      const trimmedValue = value.trim()
      const directVariableMatch = trimmedValue.match(/^<variable\.([^>]+)>$/)
      if (directVariableMatch) {
        const variableName = directVariableMatch[1]
        const variable = this.findVariableByName(variableName)
        if (variable) return this.getTypedVariableValue(variable)
        logger.warn(
          `Direct variable reference <variable.${variableName}> not found. Treating as literal.`
        )
        return value
      }

      const references = extractReferencePrefixes(trimmedValue)
      if (
        references.length === 1 &&
        references[0].raw === trimmedValue &&
        ['loop', 'parallel'].includes(references[0].prefix)
      ) {
        return this.resolveBlockReferences(value, context, block, { native: true })
      }
      return this.processStringValue(value, key, context, block)
    }
    return typeof value === 'object' ? this.processObjectValue(value, context, block, key) : value
  }
  /**
   * Retrieves the correctly typed value of a variable based on its stored type.
   * Uses VariableManager for consistent handling of all variable types.
   *
   * @param variable - The variable object from workflowVariables
   * @returns The actual typed value of the variable
   */
  private getTypedVariableValue(variable: any): any {
    if (!variable || variable.value === undefined || variable.value === null) {
      return variable?.value // Return null or undefined as is
    }

    return VariableManager.resolveForExecution(variable.value, variable.type)
  }

  /**
   * Formats a typed variable value for interpolation into a string.
   * Ensures values are formatted correctly based on their type and context.
   * Uses VariableManager for consistent handling of all variable types.
   *
   * @param value - The typed value obtained from getTypedVariableValue
   * @param type - The original variable type ('string', 'number', 'plain', etc.)
   * @param currentBlock - The block context, used for needsCodeStringLiteral check
   * @returns A string representation suitable for insertion
   */
  private formatValueForInterpolation(
    value: any,
    type: VariableType,
    currentBlock?: SerializedBlock
  ): string {
    // For plain text, use exactly what's entered without modifications
    if (type === 'plain' && typeof value === 'string') {
      return value
    }

    // Determine if this needs special handling for code contexts
    const needsCodeStringLiteral = this.needsCodeStringLiteral(currentBlock, String(value))
    const isFunctionBlock = currentBlock?.metadata?.id === 'function'

    // Always use code formatting for function blocks
    if (isFunctionBlock || needsCodeStringLiteral) {
      return VariableManager.formatForCodeContext(value, type)
    }
    return VariableManager.formatForTemplateInterpolation(value, type)
  }

  /**
   * Resolves workflow variable references in a string (<variable.name>).
   *
   * @param value - String containing variable references
   * @param currentBlock - The current block, used to determine context
   * @returns String with resolved variable references
   */
  resolveVariableReferences(value: string, currentBlock?: SerializedBlock): string {
    // Added check: If value is not a string, return it directly.
    // This can happen if a prior resolution step (like block reference) returned a non-string.
    if (typeof value !== 'string') {
      return value as any // Cast needed as function technically returns string, but might pass through others
    }

    const variableMatches = value.match(/<variable\.([^>]+)>/g)
    if (!variableMatches) return value

    let resolvedValue = value

    for (const match of variableMatches) {
      const variableName = match.slice('<variable.'.length, -1)

      // Find the variable using our helper method
      const variable = this.findVariableByName(variableName)

      if (variable) {
        // Get the actual typed value
        const typedValue = this.getTypedVariableValue(variable)

        // Format the typed value for string interpolation
        const formattedValue: string = this.formatValueForInterpolation(
          typedValue,
          variable.type,
          currentBlock
        )
        resolvedValue = resolvedValue.replace(match, formattedValue)
      } else {
        // Variable not found - leave the placeholder <variable.name> in the string? Or replace with empty string?
        // For now, let's leave it, which matches previous behavior implicitly.
        logger.warn(
          `Interpolated variable reference <variable.${variableName}> not found. Leaving as literal.`
        )
      }
    }

    return resolvedValue
  }

  /**
   * Resolves block references in a string (<blockId.property> or <blockName.property>).
   * Handles inactive paths, missing blocks, and formats values appropriately.
   *
   * @param value - String containing block references
   * @param context - Current execution context
   * @param currentBlock - Block that contains the references
   * @param referenceContext - Native value and JSON interpolation context
   * @returns String with resolved references
   * @throws Error if referenced block is not found or disabled
   */
  resolveBlockReferences(
    value: string,
    context: ExecutionContext,
    currentBlock: SerializedBlock,
    referenceContext: ReferenceContext = {}
  ): any {
    // Skip resolution for API block body content that looks like XML
    if (
      currentBlock.metadata?.id === 'api' &&
      typeof value === 'string' &&
      // Check if this looks like XML content
      (value.includes('<?xml') || value.includes('xmlns:') || value.includes('</')) &&
      value.includes('<') &&
      value.includes('>')
    ) {
      return value
    }

    const blockMatches = extractReferencePrefixes(value)
    if (blockMatches.length === 0) return value

    let resolvedValue = value
    let referenceCursor = 0

    for (const match of blockMatches) {
      const { raw } = match
      const sourceIndex = value.indexOf(raw, referenceCursor)
      referenceCursor = sourceIndex + raw.length
      const resolvedIndex = sourceIndex + resolvedValue.length - value.length
      if (raw.startsWith('<variable.') && !referenceContext.native && !referenceContext.json) {
        continue
      }

      const path = raw.slice(1, -1)
      const [blockRefToken, ...pathParts] = path.split('.')
      const blockRef = blockRefToken.trim()

      // Skip XML-like tags (but allow block names with spaces)
      if (blockRef.includes(':')) {
        continue
      }

      // Check if we're in a template literal context
      const isInTemplateLiteral =
        currentBlock.metadata?.id === 'function' &&
        value.includes('${') &&
        value.includes('}') &&
        value.includes('`')

      const blockRefLower = blockRef.toLowerCase()

      let replacementValue: any = UNRESOLVED_REFERENCE
      if (blockRefLower === 'variable') {
        const variable = this.findVariableByName(pathParts.join('.'))
        if (!variable) continue
        replacementValue = this.getTypedVariableValue(variable)
      } else if (blockRefLower === 'loop') {
        replacementValue = this.resolveLoopReference(pathParts, context, currentBlock)
      } else if (blockRefLower === 'parallel') {
        const parallelId = this.parallelsByBlockId.get(currentBlock.id)
        if (parallelId)
          replacementValue = this.resolveParallelReference(parallelId, pathParts, context)
      }

      if (replacementValue === UNRESOLVED_REFERENCE) {
        const isStartReference = blockRefLower === 'start'
        const sourceBlock = isStartReference
          ? context.triggerBlockId
            ? this.blockById.get(context.triggerBlockId)
            : undefined
          : this.validateBlockReference(blockRef, currentBlock.id)

        if (!sourceBlock) {
          if (isStartReference) {
            throw new Error('Runtime trigger block is not available for <start> reference.')
          }
          continue
        }

        if (!isStartReference && sourceBlock.enabled === false) {
          throw new Error(`Block "${sourceBlock.metadata?.name || sourceBlock.id}" is disabled`)
        }

        let blockState = context.blockStates.get(sourceBlock.id)
        if (!isStartReference && context.currentVirtualBlockId) {
          const currentParallelInfo = context.parallelBlockMapping?.get(
            context.currentVirtualBlockId
          )
          if (!currentParallelInfo) {
            throw new Error(
              `No parallel mapping found for block "${context.currentVirtualBlockId}"`
            )
          }

          const parallel = context.workflow?.parallels?.[currentParallelInfo.parallelId]
          if (parallel?.nodes.includes(sourceBlock.id)) {
            const virtualSourceBlockId = `${sourceBlock.id}_parallel_${currentParallelInfo.parallelId}_iteration_${currentParallelInfo.iterationIndex}`
            blockState = context.blockStates.get(virtualSourceBlockId)
            if (!blockState) {
              throw new Error(`No state found for block "${virtualSourceBlockId}"`)
            }
          }
        }

        replacementValue = blockState?.output

        for (const part of pathParts) {
          if (!replacementValue || typeof replacementValue !== 'object') {
            replacementValue = undefined
            break
          }

          replacementValue = this.resolvePartWithIndices(
            replacementValue,
            part,
            path,
            sourceBlock.metadata?.name || sourceBlock.id
          )

          if (replacementValue === undefined) {
            break
          }
        }
      }
      if (referenceContext.native && blockMatches.length === 1 && value.trim() === raw) {
        return replacementValue
      }

      let formattedValue: string

      if (currentBlock.metadata?.id === 'condition') {
        formattedValue = this.stringifyForCondition(replacementValue)
      } else if (referenceContext.json) {
        const jsonValue = replacementValue === undefined ? '' : replacementValue
        formattedValue = isInsideJsonString(resolvedValue, resolvedIndex)
          ? JSON.stringify(this.formatValueForCodeContext(jsonValue, currentBlock)).slice(1, -1)
          : JSON.stringify(jsonValue)
      } else if (replacementValue === undefined) {
        formattedValue =
          currentBlock.metadata?.id === 'function'
            ? this.formatValueForCodeContext(replacementValue, currentBlock, isInTemplateLiteral)
            : ''
      } else if (
        typeof replacementValue === 'string' &&
        this.needsCodeStringLiteral(currentBlock, value)
      ) {
        formattedValue = this.formatValueForCodeContext(
          replacementValue,
          currentBlock,
          isInTemplateLiteral
        )
      } else {
        // The function execution API will handle variable resolution within code strings
        formattedValue =
          typeof replacementValue === 'object'
            ? JSON.stringify(replacementValue)
            : String(replacementValue)
      }

      resolvedValue =
        resolvedValue.slice(0, resolvedIndex) +
        formattedValue +
        resolvedValue.slice(resolvedIndex + raw.length)
    }

    return resolvedValue
  }

  /**
   * Resolves environment variables in any value ({{ENV_VAR}}).
   *
   * @param value - Value that may contain environment variable references
   * @returns Value with environment variables resolved
   * @throws Error if referenced environment variable is not found
   */
  resolveEnvVariables(value: any, json = false): any {
    if (typeof value === 'string') {
      let resolvedValue = value
      let referenceCursor = 0
      for (const match of extractEnvironmentReferences(value)) {
        const envKey = match.slice(2, -2)
        const envValue = this.environmentVariables[envKey]

        if (envValue === undefined) {
          throw new Error(`Environment variable "${envKey}" was not found.`)
        }

        const resolvedIndex = resolvedValue.indexOf(match, referenceCursor)
        const formattedValue =
          json && isInsideJsonString(resolvedValue, resolvedIndex)
            ? JSON.stringify(envValue).slice(1, -1)
            : envValue
        resolvedValue =
          resolvedValue.slice(0, resolvedIndex) +
          formattedValue +
          resolvedValue.slice(resolvedIndex + match.length)
        referenceCursor = resolvedIndex + formattedValue.length
      }
      return resolvedValue
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveEnvVariables(item, json))
    }

    if (value && typeof value === 'object') {
      return Object.entries(value).reduce(
        (acc, [k, v]) => ({
          ...acc,
          [k]: this.resolveEnvVariables(v, json),
        }),
        {}
      )
    }

    return value
  }

  /**
   * Resolves references and environment variables in any nested structure (object or array).
   * This is a more general approach that handles any level of nesting.
   *
   * @param value - The value to resolve (object, array, or primitive)
   * @param context - Current execution context
   * @param currentBlock - Block that contains the references
   * @returns Resolved value with all references and environment variables processed
   */
  private resolveNestedStructure(
    value: any,
    context: ExecutionContext,
    currentBlock: SerializedBlock,
    referenceContext?: ReferenceContext
  ): any {
    // Handle null or undefined
    if (value === null || value === undefined) {
      return value
    }

    // Handle strings
    if (typeof value === 'string') {
      // First resolve variable references
      const resolvedVars = referenceContext
        ? value
        : this.resolveVariableReferences(value, currentBlock)

      // Then resolve block references
      const resolvedReferences = this.resolveBlockReferences(
        resolvedVars,
        context,
        currentBlock,
        referenceContext
      )

      const references = referenceContext?.native ? extractReferencePrefixes(value) : []
      if (references.length === 1 && references[0].raw === value.trim()) return resolvedReferences

      // Then resolve environment variables
      return this.resolveEnvVariables(resolvedReferences, referenceContext?.json)
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) =>
        this.resolveNestedStructure(item, context, currentBlock, referenceContext)
      )
    }

    // Handle objects
    if (typeof value === 'object') {
      const result: Record<string, any> = {}
      for (const [k, v] of Object.entries(value)) {
        const quoted = referenceContext?.native && k === 'value' && value.referenceQuoted === true
        const fieldContext =
          referenceContext?.native && k === 'value'
            ? {
                native: !quoted,
                json:
                  quoted ||
                  ['object', 'array', 'files', LISTING_IDENTITY_VALUE_TYPE].includes(value.type),
              }
            : undefined
        const resolved = this.resolveNestedStructure(
          quoted ? JSON.stringify(v) : v,
          context,
          currentBlock,
          fieldContext
        )
        result[k] =
          quoted ||
          (fieldContext &&
            value.referenceQuoted === false &&
            typeof v === 'string' &&
            isEnvironmentReference(v))
            ? JSON.parse(resolved)
            : resolved
      }
      return result
    }

    // Return primitives as is
    return value
  }

  /**
   * Formats a value for use in condition blocks.
   * Handles strings, null, undefined, and objects appropriately.
   *
   * @param value - Value to format
   * @returns Formatted string representation
   */
  private stringifyForCondition(value: any): string {
    if (typeof value === 'string') {
      const sanitized = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
      return `"${sanitized}"`
    }
    if (value === null) {
      return 'null'
    }
    if (typeof value === 'undefined') {
      return 'undefined'
    }
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }

  /**
   * Applies a property path part with optional array indices, e.g. "values[0][0]".
   */
  private resolvePartWithIndices(
    base: any,
    part: string,
    fullPath: string,
    sourceName: string
  ): any {
    if (!part) return undefined
    if (Array.isArray(base) && !part.startsWith('[')) {
      throw new Error(
        `Array path "${fullPath}" in block "${sourceName}" must use an explicit index.`
      )
    }

    let value = base

    // Extract the property name before any numeric indices.
    const prop = part.split(/\[\d+\]/, 1)[0]
    let rest = part.slice(prop.length)
    if (prop) {
      value = Object.hasOwn(value, prop) ? value[prop] : undefined
      if (value === undefined) {
        return undefined
      }
    }

    // Iteratively apply each [index]
    const indexRe = /^\[(\d+)\]/
    while (rest.length > 0) {
      const m = rest.match(indexRe)
      if (!m) {
        throw new Error(`Invalid path "${part}" in "${fullPath}" for block "${sourceName}".`)
      }
      const idx = Number.parseInt(m[1], 10)
      if (value === undefined) return undefined
      if (!Array.isArray(value)) {
        throw new Error(`Invalid path "${part}" in "${fullPath}" for block "${sourceName}".`)
      }
      value = value[idx]
      rest = rest.slice(m[0].length)
    }

    return value
  }

  /**
   * Helper method to find a variable by its name.
   * Handles normalization of names (removing spaces) for consistent matching.
   *
   * @param variableName - The name of the variable to find
   * @returns The found variable object or undefined if not found
   */
  private findVariableByName(variableName: string): any | undefined {
    const foundVariable = Object.entries(this.workflowVariables).find(
      ([_, variable]) => (variable.name || '').replace(/\s+/g, '') === variableName
    )

    return foundVariable ? foundVariable[1] : undefined
  }

  private getAccessibleBlocks(currentBlockId: string): Set<string> {
    const accessibleBlocks = this.accessibleBlocksMap.get(currentBlockId)
    if (!accessibleBlocks) {
      throw new Error(`Missing accessible block map for ${currentBlockId}`)
    }
    return accessibleBlocks
  }

  /**
   * Validates if a block reference is accessible from the current block.
   * Checks existence and connection-based access rules.
   *
   * @param blockRef - Name or ID of the referenced block
   * @param currentBlockId - ID of the block making the reference
   * @returns The accessible source block, or undefined
   */
  private validateBlockReference(
    blockRef: string,
    currentBlockId: string
  ): SerializedBlock | undefined {
    const sourceBlock =
      this.blockById.get(blockRef) || this.blockByNormalizedName.get(normalizeBlockName(blockRef))
    if (!sourceBlock) return undefined

    const accessibleBlocks = this.getAccessibleBlocks(currentBlockId)
    const isAlwaysAccessibleTrigger =
      sourceBlock.metadata?.category === 'triggers' ||
      sourceBlock.config.params.triggerMode === true

    if (
      sourceBlock.id !== currentBlockId &&
      !isAlwaysAccessibleTrigger &&
      !accessibleBlocks.has(sourceBlock.id)
    ) {
      return undefined
    }

    return sourceBlock
  }

  /**
   * Formats a value for safe use in a code context (like function blocks).
   * Ensures strings are properly quoted in JavaScript.
   *
   * @param value - The value to format
   * @param block - The block that will use this value
   * @param isInTemplateLiteral - Whether this value is inside a template literal
   * @returns Properly formatted value for code insertion
   */
  private formatValueForCodeContext(
    value: any,
    block: SerializedBlock,
    isInTemplateLiteral = false
  ): string {
    // For function blocks, properly format values to avoid syntax errors
    if (block.metadata?.id === 'function') {
      // Special case for values in template literals (like `Hello ${<loop.currentItem>}`)
      if (isInTemplateLiteral) {
        if (typeof value === 'string') {
          return value // Don't quote strings in template literals
        }
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value) // But do stringify objects
        }
        return String(value)
      }

      // Regular (non-template) contexts - ALL strings need to be quoted for JavaScript
      if (typeof value === 'string') {
        // Always quote strings for JavaScript code
        return JSON.stringify(value)
      }
      if (typeof value === 'object' && value !== null) {
        // Stringify objects and arrays
        return JSON.stringify(value)
      }
      if (value === undefined) {
        return 'undefined'
      }
      if (value === null) {
        return 'null'
      }
      // Numbers, booleans can be inserted as is
      return String(value)
    }

    // For non-code blocks, use normal string conversion
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  }

  /**
   * Determines if a value needs to be formatted as a code-compatible string literal
   * based on the block type and context. Handles JavaScript and other code contexts.
   *
   * @param block - The block where the value is being used
   * @param expression - The expression containing the value (used for context checks)
   * @returns Whether the value should be formatted as a string literal
   */
  private needsCodeStringLiteral(block?: SerializedBlock, expression?: string): boolean {
    if (!block) return false

    // These block types execute code and need properly formatted string literals
    const codeExecutionBlocks = ['function', 'condition']

    // Check if this is a block that executes code
    if (block.metadata?.id && codeExecutionBlocks.includes(block.metadata.id)) {
      // Always return true for function blocks - they need properly formatted string literals
      if (block.metadata.id === 'function') {
        return true
      }

      // Specifically for condition blocks, stringifyForCondition handles quoting
      // so we don't need extra quoting here unless it's within an expression.
      if (block.metadata.id === 'condition' && !expression) {
        return false
      }
      return true
    }

    // Check if the expression itself looks like code, which might indicate
    // that even in non-code blocks, a variable needs string literal formatting.
    if (expression) {
      const codeIndicators = [
        // Function/method calls
        /\(\s*$/, // Function call
        /\.\w+\s*\(/, // Method call

        // JavaScript/Python operators
        /[=<>!+\-*/%](?:==?)?/, // Common operators
        /\+=|-=|\*=|\/=|%=|\*\*=?/, // Assignment operators

        // JavaScript keywords
        /\b(if|else|for|while|return|var|let|const|function)\b/,

        // Python keywords
        /\b(if|else|elif|for|while|def|return|import|from|as|class|with|try|except)\b/,

        // Common code patterns
        /^['"]use strict['"]?$/, // JS strict mode
        /\$\{.+?\}/, // JS template literals
        /f['"].*?['"]/, // Python f-strings
        /\bprint\s*\(/, // Python print
        /\bconsole\.\w+\(/, // JS console methods
      ]

      // Check if the expression (which might contain the variable placeholder) matches code patterns
      return codeIndicators.some((pattern) => pattern.test(expression))
    }

    return false
  }

  /**
   * Resolves a loop reference (<loop.property>).
   * Handles currentItem, items, and index references.
   *
   * @param pathParts - Parts of the reference path after 'loop'
   * @param context - Current execution context
   * @returns Native value or UNRESOLVED_REFERENCE if the property is unsupported
   */
  private resolveLoopReference(
    pathParts: string[],
    context: ExecutionContext,
    currentBlock: SerializedBlock
  ): unknown {
    const loopId = getLoopContextId(
      currentBlock.id,
      context.workflow?.loops ?? {},
      this.loopsByBlockId.get(currentBlock.id)
    )
    if (!loopId) return UNRESOLVED_REFERENCE

    const loop = context.workflow?.loops[loopId]
    if (!loop) return UNRESOLVED_REFERENCE

    const property = pathParts[0]

    switch (property) {
      case 'currentItem': {
        // Get the current item from context (set by loop handler)
        const currentItem = context.loopItems.get(loopId)
        if (currentItem === undefined) {
          // If no current item stored, we're probably not in an active iteration
          return undefined
        }

        // Handle nested path access (e.g., <loop.currentItem.key>)
        if (pathParts.length > 1) {
          // Special handling for [key, value] pairs from Object.entries()
          if (
            Array.isArray(currentItem) &&
            currentItem.length === 2 &&
            typeof currentItem[0] === 'string'
          ) {
            const subProperty = pathParts[1]
            if (subProperty === 'key') {
              return currentItem[0]
            }
            if (subProperty === 'value') {
              return currentItem[1]
            }
          }

          // Navigate nested path for objects
          let value = currentItem
          for (let i = 1; i < pathParts.length; i++) {
            if (!value || typeof value !== 'object') {
              throw new Error(`Invalid path "${pathParts[i]}" in loop item reference`)
            }
            value = (value as any)[pathParts[i] as any]
            if (value === undefined) {
              throw new Error(`No value found at path "loop.${pathParts.join('.')}" in loop item`)
            }
          }
          return value
        }

        // Return the whole current item
        return currentItem
      }

      case 'items': {
        // Only valid for forEach loops
        if (loop.loopType !== 'forEach') {
          return UNRESOLVED_REFERENCE
        }

        const items = context.loopItems.get(`${loopId}_items`)
        if (!items) throw new Error(`Evaluated items not found for loop ${loopId}`)

        return items
      }

      case 'index': {
        // The manager advances the one-based counter after each completed body.
        return (context.loopIterations.get(loopId) ?? 1) - 1
      }

      default:
        return UNRESOLVED_REFERENCE
    }
  }

  /**
   * Resolves a parallel reference (<parallel.property>).
   * Handles currentItem, items, and index references for parallel executions.
   *
   * @param parallelId - ID of the parallel block
   * @param pathParts - Parts of the reference path after 'parallel'
   * @param context - Current execution context
   * @returns Native value or UNRESOLVED_REFERENCE if the property is unsupported
   */
  private resolveParallelReference(
    parallelId: string,
    pathParts: string[],
    context: ExecutionContext
  ): unknown {
    const parallel = context.workflow?.parallels?.[parallelId]
    if (!parallel) return UNRESOLVED_REFERENCE

    const property = pathParts[0]

    // For parallel blocks, we need to determine which parallel iteration this block is part of
    // This is more complex than loops since multiple instances run concurrently

    switch (property) {
      case 'currentItem': {
        let currentItem: unknown

        // If we have a current virtual block ID, use it to get the exact iteration
        if (context.currentVirtualBlockId && context.parallelBlockMapping) {
          const mapping = context.parallelBlockMapping.get(context.currentVirtualBlockId)
          if (mapping && mapping.parallelId === parallelId) {
            const iterationKey = `${parallelId}_iteration_${mapping.iterationIndex}`
            const iterationItem = context.loopItems.get(iterationKey)
            if (iterationItem !== undefined) {
              currentItem = iterationItem
            }
          }
        }

        if (currentItem === undefined) {
          return undefined
        }

        // Handle nested path access (e.g., <parallel.currentItem.key>)
        if (pathParts.length > 1) {
          // Special handling for [key, value] pairs from Object.entries()
          if (
            Array.isArray(currentItem) &&
            currentItem.length === 2 &&
            typeof currentItem[0] === 'string'
          ) {
            const subProperty = pathParts[1]
            if (subProperty === 'key') {
              return currentItem[0]
            }
            if (subProperty === 'value') {
              return currentItem[1]
            }
          }

          // Navigate nested path for objects
          let value = currentItem
          for (let i = 1; i < pathParts.length; i++) {
            if (!value || typeof value !== 'object') {
              throw new Error(`Invalid path "${pathParts[i]}" in parallel item reference`)
            }
            value = (value as any)[pathParts[i] as any]
            if (value === undefined) {
              throw new Error(
                `No value found at path "parallel.${pathParts.join('.')}" in parallel item`
              )
            }
          }
          return value
        }

        // Return the whole current item
        return currentItem
      }

      case 'items': {
        if (parallel.parallelType !== 'collection') return UNRESOLVED_REFERENCE

        const items = context.loopItems.get(`${parallelId}_items`)
        if (!items) throw new Error(`Evaluated items not found for parallel ${parallelId}`)

        return items
      }

      case 'index': {
        // Get the current parallel index
        let index: number | undefined

        // If we have a current virtual block ID, use it to get the exact iteration
        if (context.currentVirtualBlockId && context.parallelBlockMapping) {
          const mapping = context.parallelBlockMapping.get(context.currentVirtualBlockId)
          if (mapping && mapping.parallelId === parallelId) {
            index = mapping.iterationIndex
          }
        }

        const adjustedIndex = index !== undefined ? index : 0
        return adjustedIndex
      }

      default:
        return UNRESOLVED_REFERENCE
    }
  }

  /**
   * Processes a string value that may contain interpolations and references.
   * Handles the full resolution pipeline: variables -> blocks -> environment.
   *
   * @param value - String value to process
   * @param key - The parameter key (for special handling)
   * @param context - Current execution context
   * @param block - Block containing the value
   * @returns Processed value (may be parsed JSON or string)
   */
  private processStringValue(
    value: string,
    key: string,
    context: ExecutionContext,
    block: SerializedBlock
  ): any {
    const referenceContext =
      block.metadata?.id === 'response' && key === 'data' ? { json: true } : undefined
    const resolvedEnv = this.resolveNestedStructure(value, context, block, referenceContext)

    // Special handling for different block types
    const blockType = block.metadata?.id

    // For function blocks, code input doesn't need JSON parsing
    if (blockType === 'function' && key === 'code') {
      return resolvedEnv
    }

    // For API blocks, handle body input specially
    if (blockType === 'api' && key === 'body') {
      return this.tryParseJSON(resolvedEnv)
    }

    // For other inputs, try to convert JSON strings to objects/arrays
    return this.tryParseJSON(resolvedEnv)
  }

  private resolveConditionTemplate(
    template: string,
    context: ExecutionContext,
    block: SerializedBlock
  ): string {
    const resolvedVars = this.resolveVariableReferences(template, block)
    const resolvedReferences = this.resolveBlockReferences(resolvedVars, context, block)
    const resolvedEnv = this.resolveEnvVariables(resolvedReferences)

    if (typeof resolvedEnv === 'string') {
      return resolvedEnv
    }
    if (resolvedEnv === null || resolvedEnv === undefined) {
      return ''
    }
    return typeof resolvedEnv === 'object' ? JSON.stringify(resolvedEnv) : String(resolvedEnv)
  }

  /**
   * Processes object/array values recursively.
   * Handles special cases like table-like arrays with cells.
   *
   * @param value - Object or array to process
   * @param context - Current execution context
   * @param block - Block containing the value
   * @returns Processed object/array
   */
  private processObjectValue(
    value: any,
    context: ExecutionContext,
    block: SerializedBlock,
    inputKey?: string
  ): any {
    // Special handling for table-like arrays (e.g., from API params/headers)
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'object' && item !== null && 'cells' in item)
    ) {
      // Resolve each cell's value within the array
      return value.map((row) => ({
        ...row,
        cells: Object.entries(row.cells).reduce(
          (acc, [cellKey, cellValue]) => {
            if (typeof cellValue === 'string') {
              const trimmedValue = cellValue.trim()
              // Check for direct variable reference
              const directVariableMatch = trimmedValue.match(/^<variable\.([^>]+)>$/)

              if (directVariableMatch) {
                const variableName = directVariableMatch[1]
                const variable = this.findVariableByName(variableName)

                if (variable) {
                  acc[cellKey] = this.getTypedVariableValue(variable)
                } else {
                  logger.warn(
                    `Variable reference <variable.${variableName}> not found in table cell`
                  )
                  acc[cellKey] = cellValue
                }
              } else {
                // Process interpolated variables, block references, and environment variables
                acc[cellKey] = this.resolveNestedStructure(cellValue, context, block)
              }
            } else {
              // Handle non-string values
              acc[cellKey] = this.resolveNestedStructure(cellValue, context, block)
            }
            return acc
          },
          {} as Record<string, any>
        ),
      }))
    }

    // Use general recursive resolution for other objects/arrays
    return this.resolveNestedStructure(
      value,
      context,
      block,
      inputKey === 'builderData' ? { native: true } : undefined
    )
  }

  /**
   * Tries to parse a string as JSON if it looks like JSON.
   * Returns the original string if parsing fails or it doesn't look like JSON.
   *
   * @param value - Value to potentially parse
   * @returns Parsed JSON or original value
   */
  private tryParseJSON(value: any): any {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()
    if (trimmed.length > 0 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        return JSON.parse(trimmed)
      } catch {
        // Not valid JSON, return as string
      }
    }

    return value
  }

  /**
   * Get the containing loop ID for a block
   * @param blockId - The ID of the block
   * @returns The containing loop ID or undefined if not in a loop
   */
  getContainingLoopId(blockId: string): string | undefined {
    return this.loopsByBlockId.get(blockId)
  }

  /**
   * Get the containing parallel ID for a block
   * @param blockId - The ID of the block
   * @returns The containing parallel ID or undefined if not in a parallel
   */
  getContainingParallelId(blockId: string): string | undefined {
    return this.parallelsByBlockId.get(blockId)
  }

  private getAccessiblePrefixes(block: SerializedBlock): Set<string> {
    const prefixes = new Set<string>()

    const accessibleBlocks = this.getAccessibleBlocks(block.id)
    accessibleBlocks.forEach((blockId) => {
      prefixes.add(normalizeBlockName(blockId))
      const sourceBlock = this.blockById.get(blockId)
      if (sourceBlock?.metadata?.name) {
        prefixes.add(normalizeBlockName(sourceBlock.metadata.name))
      }
    })

    // Allow references to any known block (mirror tradinggoose's global tag resolution)
    this.workflow.blocks.forEach((workflowBlock) => {
      prefixes.add(normalizeBlockName(workflowBlock.id))
      if (workflowBlock.metadata?.name) {
        prefixes.add(normalizeBlockName(workflowBlock.metadata.name))
      }
    })

    SYSTEM_REFERENCE_PREFIXES.forEach((prefix) => prefixes.add(prefix))

    return prefixes
  }
}
