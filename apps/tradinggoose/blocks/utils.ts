import type {
  BlockOptionLoaderContext,
  BlockOutput,
  OutputFieldDefinition,
  ParamConfig,
  ParamType,
  SubBlockOption,
} from '@/blocks/types'
import type { ToolConfig } from '@/tools/types'

export function resolveOutputType(
  outputs: Record<string, OutputFieldDefinition>
): Record<string, BlockOutput> {
  const resolvedOutputs: Record<string, BlockOutput> = {}

  for (const [key, outputType] of Object.entries(outputs)) {
    if (typeof outputType === 'object' && outputType !== null && 'type' in outputType) {
      resolvedOutputs[key] = outputType.type as BlockOutput
    } else {
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

export const requiredUserOnlyInput = (type: ParamType, description: string): ParamConfig => ({
  type,
  description,
  required: true,
  visibility: 'user-only',
})

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
          required: config.required ?? false,
          visibility: config.visibility ?? (config.required ? 'user-or-llm' : 'user-only'),
        } satisfies ParamConfig,
      ])
  )
}

const readContextString = (contextValues: Record<string, unknown> | undefined, key: string) => {
  const value = contextValues?.[key]
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) {
    return String((value as { value?: unknown }).value ?? '')
  }
  return ''
}

export const fetchTradingPortfolioIdentityOptions = async (
  _blockId: string,
  _subBlockId: string,
  context: BlockOptionLoaderContext
): Promise<SubBlockOption[]> => {
  const provider = readContextString(context.contextValues, 'provider')
  if (!provider) return []

  const response = await fetch(
    `/api/providers/trading/portfolio-identities?provider=${encodeURIComponent(provider)}`,
    { cache: 'no-store' }
  )
  if (!response.ok) return []

  const data = (await response.json()) as { options?: SubBlockOption[] }
  return data.options ?? []
}
