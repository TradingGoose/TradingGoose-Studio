import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
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
  collapsed?: boolean
}

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
  static convertBuilderDataToJsonString(builderData: JSONProperty[]): string {
    if (!Array.isArray(builderData) || builderData.length === 0) {
      return '{\n  \n}'
    }

    const result: any = {}

    for (const prop of builderData) {
      if (!prop.name || !prop.name.trim()) {
        continue
      }

      // For UI display, keep variable references as-is without processing
      result[prop.name] = prop.value
    }

    // Convert to JSON string, then replace quoted variable references with unquoted ones
    let jsonString = JSON.stringify(result, null, 2)

    // Replace quoted variable references with unquoted ones
    // Pattern: "<variable.name>" -> <variable.name>
    jsonString = jsonString.replace(/"(<[^>]+>)"/g, '$1')

    return jsonString
  }

  private convertPropertyValue(prop: JSONProperty): any {
    const { type, value } = prop
    if (
      type !== 'string' &&
      (value == null ||
        (typeof value === 'string' && (!value.trim() || this.isVariableReference(value))))
    ) {
      return undefined
    }
    switch (type) {
      case 'object':
      case LISTING_IDENTITY_VALUE_TYPE:
      case 'array':
      case 'files':
        return typeof value === 'string' ? JSON.parse(value) : value
      case 'number':
        return this.convertNumberValue(value)
      case 'boolean':
        return this.convertBooleanValue(value)
      default:
        return value
    }
  }

  private convertNumberValue(value: any): any {
    const numValue = Number(value)
    return Number.isFinite(numValue) ? numValue : undefined
  }

  private convertBooleanValue(value: any): any {
    if (value === 'true' || value === true) return true
    if (value === 'false' || value === false) return false
    return undefined
  }

  private isVariableReference(value: any): boolean {
    return typeof value === 'string' && value.trim().startsWith('<') && value.trim().includes('>')
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
