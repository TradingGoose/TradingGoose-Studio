import type { BlockOutput, OutputFieldDefinition, ParamConfig, ParamType } from '@/blocks/types'
import type { ToolConfig } from '@/tools/types'

export function resolveOutputType(
  outputs: Record<string, OutputFieldDefinition>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputType] of Object.entries(outputs)) {
    // Handle new format: { type: 'string', description: '...' }
    if (typeof outputType === 'object' && outputType !== null && 'type' in outputType) {
      resolvedOutputs[key] = outputType.type as BlockOutput
    } else {
      // Handle old format: just the type as string, or other object formats
      resolvedOutputs[key] = outputType as BlockOutput
    }
  }

  return resolvedOutputs
}


interface ToolInputOptions {
  includeHidden?: boolean
  include?: string[]
  exclude?: string[]
}

const toParamType = (type: string): ParamType => {
  const allowed: ParamType[] = ['string', 'number', 'boolean', 'json', 'array']
  return allowed.includes(type as ParamType) ? (type as ParamType) : 'string'
}

export const buildInputsFromToolParams = (
  params: ToolConfig['params'],
  options: ToolInputOptions = {}
): Record<string, ParamConfig> => {
  const { includeHidden = false, include = [], exclude = [] } = options

  return Object.fromEntries(
    Object.entries(params)
      .filter(([key, config]) => {
        if (exclude.includes(key)) return false
        if (!includeHidden && config.visibility === 'hidden' && !include.includes(key)) {
          return false
        }
        return true
      })
      .map(([key, config]) => [
        key,
        {
          type: toParamType(config.type),
          description: config.description,
        } satisfies ParamConfig,
      ])
  )
}
