import { isWorkflowParamType } from '@/lib/workflows/value-types'
import type {
  BlockOptionLoaderContext,
  BlockOutput,
  OutputFieldDefinition,
  ParamConfig,
  ParamType,
  SubBlockOption,
} from '@/blocks/types'
import {
  getAvailableTradingProviderOptions,
  getTradingProviderOAuthServiceIds,
  getTradingProvidersByKind,
} from '@/providers/trading/providers'
import type { TradingOperationKind } from '@/providers/trading/types'
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
  if (isWorkflowParamType(type)) return type
  throw new Error(`Unsupported block input type: ${type}`)
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
  return typeof value === 'string' ? value : ''
}

export const fetchTradingProviderOptionsByKind =
  (kind: TradingOperationKind) => async (): Promise<SubBlockOption[]> => {
    const providers = getTradingProvidersByKind(kind)
    const providerIds = Array.from(
      new Set(providers.flatMap((provider) => getTradingProviderOAuthServiceIds(provider.id)))
    )
    const query = providerIds.length
      ? `?providers=${encodeURIComponent(providerIds.join(','))}`
      : ''

    const response = await fetch(`/api/auth/oauth/providers${query}`, {
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error('Failed to load trading providers')
    }

    const availability = (await response.json()) as Record<string, boolean>
    return getAvailableTradingProviderOptions(availability, kind).map((provider) => ({
      label: provider.name,
      id: provider.id,
    }))
  }

export const fetchTradingPortfolioIdentityOptions = async (
  _blockId: string,
  _subBlockId: string,
  context: BlockOptionLoaderContext
): Promise<SubBlockOption[]> => {
  const provider = readContextString(context.contextValues, 'provider')
  if (!provider || !context.workspaceId) return []

  const params = new URLSearchParams({ provider, workspaceId: context.workspaceId })

  const response = await fetch(`/api/providers/trading/portfolio-identities?${params}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Failed to load trading accounts')
  }

  const data = (await response.json()) as { options?: SubBlockOption[] }
  return data.options ?? []
}
