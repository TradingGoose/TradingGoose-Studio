import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { getBlock } from '@/blocks'
import { getTrigger } from '@/triggers'
import { resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'

/**
 * Get the effective outputs for a block, including dynamic outputs from inputFormat
 * and trigger outputs for blocks in trigger mode
 */
export function readBlockOutputs(
  blockType: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): Record<string, any> {
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return {}

  // If block is in trigger mode, use trigger outputs instead of block outputs
  if (triggerMode && blockConfig.triggers?.enabled) {
    const triggerId = resolveTriggerIdFromSubBlocks(subBlocks, blockConfig.triggers.available)
    if (triggerId) {
      const trigger = getTrigger(triggerId)
      if (trigger?.outputs) {
        return trigger.outputs
      }
    }
  }

  // Start with the static outputs defined in the config
  let outputs = { ...(blockConfig.outputs || {}) }

  if (blockType === 'agent') {
    const responseFormatValue = subBlocks?.responseFormat?.value
    if (responseFormatValue) {
      const parsed = parseResponseFormatSafely(responseFormatValue, 'agent')
      if (parsed) {
        const fields = extractFieldsFromSchema(parsed)
        if (fields.length > 0) {
          const responseOutputs: Record<string, any> = {}
          for (const field of fields) {
            responseOutputs[field.name] = {
              type: field.type || 'any',
              description: field.description || `Field from Agent: ${field.name}`,
            }
          }
          return responseOutputs
        }
      }
    }
  }

  const inputFormat = subBlocks?.inputFormat?.value
  if (
    inputFormat &&
    blockConfig.subBlocks?.some((subBlock) => subBlock.type === 'input-format') &&
    ['api_trigger', 'input_trigger', 'generic_webhook', 'human_in_the_loop'].includes(blockType)
  ) {
    const fields = Array.isArray(inputFormat) ? inputFormat : []
    // HITL keeps review links; unconfigured webhooks keep their pass-through body.
    if (
      blockType === 'api_trigger' ||
      blockType === 'input_trigger' ||
      (blockType === 'generic_webhook' && fields.length > 0)
    ) {
      outputs = {}
    }
    for (const field of fields) {
      if (field?.name && field.name.trim() !== '') {
        outputs[field.name] = {
          type: field.type || 'any',
          description: 'Field from input format',
        }
      }
    }
  }

  return outputs
}

/**
 * Get output paths for a block (for tag dropdown)
 */
export function getBlockOutputPaths(
  blockType: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): string[] {
  const outputs = readBlockOutputs(blockType, subBlocks, triggerMode)

  // Recursively collect all paths from nested outputs
  const paths: string[] = []

  function collectPaths(obj: Record<string, any>, prefix = ''): void {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key

      // Typed objects expose both their value and their declared properties.
      if (value && typeof value === 'object' && typeof value.type === 'string') {
        // Special handling for 'files' type - expand to show array element properties
        if (value.type === 'files') {
          // Show properties without [0] for cleaner display
          // The tag dropdown will add [0] automatically when inserting
          paths.push(`${path}.url`)
          paths.push(`${path}.name`)
          paths.push(`${path}.size`)
          paths.push(`${path}.type`)
          paths.push(`${path}.key`)
          paths.push(`${path}.uploadedAt`)
          paths.push(`${path}.expiresAt`)
        } else {
          paths.push(path)
          if (
            value.type === 'object' &&
            value.properties &&
            typeof value.properties === 'object' &&
            !Array.isArray(value.properties)
          ) {
            collectPaths(value.properties, path)
          }
        }
      }
      // If value is an object without 'type', recurse into it
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        collectPaths(value, path)
      }
      // Otherwise treat as a leaf node
      else {
        paths.push(path)
      }
    }
  }

  collectPaths(outputs)
  return paths
}

/**
 * Get the type of a specific output path (supports nested paths like "email.subject")
 */
export function getBlockOutputType(
  blockType: string,
  outputPath: string,
  subBlocks?: Record<string, any>,
  triggerMode?: boolean
): string {
  const outputs = readBlockOutputs(blockType, subBlocks, triggerMode)

  const arrayIndexRegex = /\[(\d+)\]/g
  const cleanPath = outputPath.replace(arrayIndexRegex, '')
  const pathParts = cleanPath.split('.').filter(Boolean)
  if (pathParts.length === 0) return 'any'

  const filePropertyTypes: Record<string, string> = {
    url: 'string',
    name: 'string',
    size: 'number',
    type: 'string',
    key: 'string',
    uploadedAt: 'string',
    expiresAt: 'string',
  }

  let current: any = outputs[pathParts[0]]

  for (let index = 1; index < pathParts.length; index++) {
    const part = pathParts[index]
    if (!current || typeof current !== 'object') {
      return 'any'
    }
    if (typeof current.type === 'string') {
      if (current.type === 'files' && index === pathParts.length - 1) {
        return Object.hasOwn(filePropertyTypes, part) ? filePropertyTypes[part] : 'any'
      }
      current = current.type === 'object' ? current.properties?.[part] : undefined
    } else {
      current = current[part]
    }
  }

  if (!current) return 'any'

  if (typeof current === 'object' && typeof current.type === 'string') {
    return current.type
  }

  return typeof current === 'string' ? current : 'any'
}
