import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import { extractEnvironmentReferences, extractReferencePrefixes } from '@/lib/workflows/references'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('ResponseBlockHandler')

interface JSONProperty {
  id: string
  name: string
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'files'
    | typeof LISTING_IDENTITY_VALUE_TYPE
  value: any
  referenceQuoted?: boolean
  collapsed?: boolean
}

const JSON_PROPERTY_TYPES = new Set(['object', 'array', 'files', LISTING_IDENTITY_VALUE_TYPE])

export class ResponseBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.RESPONSE
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<NormalizedBlockOutput> {
    logger.info(`Executing response block: ${block.id}`)

    try {
      const responseData = this.parseResponseData(inputs)
      const statusCode = this.parseStatus(inputs.status)
      const responseHeaders = this.parseHeaders(inputs.headers)

      logger.info('Response prepared', {
        status: statusCode,
        dataKeys: Object.keys(responseData),
        headerKeys: Object.keys(responseHeaders),
      })

      return {
        response: {
          data: responseData,
          status: statusCode,
          headers: responseHeaders,
        },
      }
    } catch (error: any) {
      logger.error('Response block execution failed:', error)
      return {
        response: {
          data: {
            error: 'Response block execution failed',
            message: error.message || 'Unknown error',
          },
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      }
    }
  }

  private parseResponseData(inputs: Record<string, any>): any {
    const dataMode = inputs.dataMode || 'structured'

    if (dataMode === 'json') {
      // Handle JSON mode - data comes from code editor
      if (typeof inputs.data === 'string') {
        return inputs.data.trim() ? JSON.parse(inputs.data) : {}
      }
      if (typeof inputs.data === 'object' && inputs.data !== null) {
        // Data is already an object, return as-is
        return inputs.data
      }
      return {}
    }

    if (dataMode === 'structured') {
      // Handle structured mode - convert builderData to JSON
      return this.convertBuilderDataToJson(inputs.builderData)
    }

    throw new Error(`Unsupported response data mode: ${dataMode}`)
  }

  private convertBuilderDataToJson(builderData: JSONProperty[]): any {
    if (!Array.isArray(builderData)) {
      return {}
    }

    const result: any = {}

    for (const prop of builderData) {
      if (!prop.name || !prop.name.trim()) {
        continue
      }

      const value = this.convertPropertyValue(prop)
      if (value !== undefined) result[prop.name] = value
    }

    return result
  }

  // Static method for UI conversion from Builder to Editor mode
  static convertBuilderDataToJsonString(builderData: JSONProperty[]): string | undefined {
    const converter = new ResponseBlockHandler()
    const result: Record<string, string> = {}

    for (const prop of builderData) {
      if (!prop.name || !prop.name.trim()) continue

      const references = typeof prop.value === 'string' ? extractReferencePrefixes(prop.value) : []
      const exactReference = references.length === 1 && references[0].raw === prop.value.trim()
      if (
        prop.type !== 'string' &&
        (exactReference ||
          ((prop.type === 'number' || prop.type === 'boolean') &&
            typeof prop.value === 'string' &&
            (references.length > 0 || extractEnvironmentReferences(prop.value).length > 0)))
      ) {
        return undefined
      }
      const rawJson =
        typeof prop.value === 'string' &&
        prop.value.trim().length > 0 &&
        prop.referenceQuoted !== true &&
        (prop.referenceQuoted === false || JSON_PROPERTY_TYPES.has(prop.type) || exactReference)
      const value = rawJson ? prop.value : converter.convertPropertyValue(prop)
      if (value !== undefined) result[prop.name] = rawJson ? value : JSON.stringify(value, null, 2)
    }

    return `{\n${Object.entries(result)
      .map(([name, value]) => `  ${JSON.stringify(name)}: ${value}`)
      .join(',\n')}\n}`
  }

  private convertPropertyValue(prop: JSONProperty): any {
    const { type, value } = prop
    const text = typeof value === 'string' ? value.trim() : undefined
    if (
      type !== 'string' &&
      (value == null || text === '' || (text?.startsWith('<') && text.includes('>')))
    ) {
      return undefined
    }
    if (JSON_PROPERTY_TYPES.has(type)) return typeof value === 'string' ? JSON.parse(value) : value
    switch (type) {
      case 'number': {
        const number = Number(value)
        return Number.isFinite(number) ? number : undefined
      }
      case 'boolean':
        if (value === 'true' || value === true) return true
        if (value === 'false' || value === false) return false
        return undefined
      default:
        return value
    }
  }

  private parseStatus(status?: string): number {
    if (!status) return 200
    const parsed = Number(status)
    if (Number.isNaN(parsed) || parsed < 100 || parsed > 599) {
      return 200
    }
    return parsed
  }

  private parseHeaders(
    headers: {
      id: string
      cells: { Key: string; Value: string }
    }[]
  ): Record<string, string> {
    const defaultHeaders = { 'Content-Type': 'application/json' }
    if (!headers) return defaultHeaders

    const headerObj = headers.reduce((acc: Record<string, string>, header) => {
      if (header?.cells?.Key && header?.cells?.Value) {
        acc[header.cells.Key] = header.cells.Value
      }
      return acc
    }, {})

    return { ...defaultHeaders, ...headerObj }
  }
}
