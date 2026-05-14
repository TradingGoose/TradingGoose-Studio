import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ResponseFormatUtils')

// Type definitions for component data structures
export interface Field {
  name: string
  type: string
  description?: string
}

/**
 * Helper function to extract fields from JSON Schema
 */
export function extractFieldsFromSchema(schema: any): Field[] {
  if (!schema || typeof schema !== 'object') {
    return []
  }

  const schemaObj = schema.schema || schema
  if (!schemaObj || !schemaObj.properties || typeof schemaObj.properties !== 'object') {
    return []
  }

  // Extract fields from schema properties
  return Object.entries(schemaObj.properties).map(([name, prop]: [string, any]) => {
    // Handle array format like ['string', 'array']
    if (Array.isArray(prop)) {
      return {
        name,
        type: prop.includes('array') ? 'array' : prop[0] || 'string',
        description: undefined,
      }
    }

    // Handle object format like { type: 'string', description: '...' }
    return {
      name,
      type: prop.type || 'string',
      description: prop.description,
    }
  })
}

/**
 * Helper function to safely parse response format
 * Handles both string and object formats
 */
export function parseResponseFormatSafely(responseFormatValue: any, blockId: string): any {
  if (!responseFormatValue) {
    return null
  }

  try {
    if (typeof responseFormatValue === 'string') {
      const trimmedValue = responseFormatValue.trim()
      if (!trimmedValue || (trimmedValue.startsWith('<') && trimmedValue.includes('>'))) {
        return null
      }
      return JSON.parse(trimmedValue)
    }
    return responseFormatValue
  } catch (error) {
    logger.warn(`Failed to parse response format for block ${blockId}:`, error)
    return null
  }
}

/**
 * Extract block ID from output ID
 */
export function extractBlockIdFromOutputId(outputId: string): string {
  const separatorIndex = outputId.indexOf('_')
  return separatorIndex === -1 ? outputId : outputId.slice(0, separatorIndex)
}

/**
 * Extract path from output ID after the block ID
 */
export function extractPathFromOutputId(outputId: string, blockId: string): string {
  return outputId.substring(blockId.length + 1)
}

/**
 * Parse JSON content from output safely
 * Handles both string and object formats with proper error handling
 */
export function parseOutputContentSafely(output: any): any {
  if (!output?.content) {
    return output
  }

  if (typeof output.content === 'string') {
    try {
      return JSON.parse(output.content)
    } catch (e) {
      // Fallback to original structure if parsing fails
      return output
    }
  }

  return output
}

/**
 * Internal helper to traverse an object path without parsing
 * @param obj The object to traverse
 * @param path The dot-separated path (e.g., "result.data.value")
 * @returns The value at the path, or undefined if path doesn't exist
 */
function traverseObjectPathInternal(obj: any, path: string): any {
  if (!path) return obj

  let current = obj
  const parts = path.split('.')

  for (const part of parts) {
    if (current?.[part] !== undefined) {
      current = current[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Traverses an object path safely, returning undefined if any part doesn't exist
 * Automatically handles parsing of output content if needed
 * @param obj The object to traverse (may contain unparsed content)
 * @param path The dot-separated path (e.g., "result.data.value")
 * @returns The value at the path, or undefined if path doesn't exist
 */
export function traverseObjectPath(obj: any, path: string): any {
  const parsed = parseOutputContentSafely(obj)
  return traverseObjectPathInternal(parsed, path)
}
