import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig, SubBlockCondition, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { buildInputsFromToolParams } from '@/blocks/utils'
import {
  getTradingProviderParamCatalog,
  getTradingProviderParamDefinitions,
  getTradingProviderIdsForParam,
  getTradingProviders,
} from '@/providers/trading'
import { getTradingOrderTypeOptions } from '@/providers/trading/order-types'
import type { TradingProviderParamDefinition } from '@/providers/trading/providers'
import { tradingActionTool } from '@/tools/trading'
import type { TradingActionResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

const providersWithEnvironment = getTradingProviderIdsForParam('order', 'environment')

const BLOCK_RESERVED_PARAM_IDS = new Set([
  'provider',
  'credential',
  'environment',
  'side',
  'listing',
  'orderType',
  'limitPrice',
  'stopPrice',
  'trailPrice',
  'trailPercent',
  'timeInForce',
])

const TOOL_RESERVED_PARAM_IDS = new Set([
  'provider',
  'credential',
  'environment',
  'side',
  'listing',
  'quantity',
  'notional',
  'orderType',
  'limitPrice',
  'stopPrice',
  'trailPrice',
  'trailPercent',
  'timeInForce',
])

const providerParamCatalog = getTradingProviderParamCatalog('order')
const providerParamRegistry = providerParamCatalog.registry
const providerParamOrderIndex = new Map(
  providerParamCatalog.order.map((paramId, index) => [paramId, index])
)

const orderedProviderParamIds = [...providerParamCatalog.order].sort((a, b) => {
  const aOrder = providerParamRegistry[a]?.definition.displayOrder
  const bOrder = providerParamRegistry[b]?.definition.displayOrder
  const aHasOrder = typeof aOrder === 'number'
  const bHasOrder = typeof bOrder === 'number'

  if (aHasOrder && bHasOrder && aOrder !== bOrder) {
    return aOrder - bOrder
  }
  if (aHasOrder && !bHasOrder) return -1
  if (!aHasOrder && bHasOrder) return 1
  return (providerParamOrderIndex.get(a) ?? 0) - (providerParamOrderIndex.get(b) ?? 0)
})

const isSensitiveParam = (paramId: string): boolean => {
  const lowered = paramId.toLowerCase()
  return (
    lowered.includes('apikey') ||
    lowered.includes('api_key') ||
    lowered.includes('secret') ||
    lowered.includes('token') ||
    lowered.includes('password')
  )
}

const formatParamTitle = (paramId: string): string => {
  if (paramId === 'apiKey') return 'API Key'
  if (paramId === 'apiSecret') return 'API Secret'

  if (paramId.includes('_') || paramId.includes('-')) {
    return paramId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  if (/[A-Z]/.test(paramId)) {
    const result = paramId.replace(/([A-Z])/g, ' $1')
    return (
      result.charAt(0).toUpperCase() +
      result
        .slice(1)
        .replace(/ Api/g, ' API')
        .replace(/ Id/g, ' ID')
        .replace(/ Url/g, ' URL')
        .replace(/ Uri/g, ' URI')
    )
  }

  return paramId.charAt(0).toUpperCase() + paramId.slice(1)
}

const shouldIncludeProviderParam = (
  definition: TradingProviderParamDefinition,
  reservedParams: Set<string> = BLOCK_RESERVED_PARAM_IDS
): boolean => {
  if (reservedParams.has(definition.id)) return false
  if (definition.visibility === 'hidden' || definition.visibility === 'llm-only') return false
  return true
}

const resolveParamInputType = (
  definition: TradingProviderParamDefinition
): SubBlockConfig['type'] => {
  if (definition.inputType) return definition.inputType
  if (definition.options?.length) return 'dropdown'

  switch (definition.type) {
    case 'boolean':
      return 'switch'
    case 'json':
    case 'array':
      return 'code'
    case 'number':
      return 'short-input'
    default:
      return 'short-input'
  }
}

const normalizeConditionList = (
  condition?: SubBlockCondition | SubBlockCondition[]
): SubBlockCondition[] => {
  if (!condition) return []
  return Array.isArray(condition) ? condition : [condition]
}

const mergeParamConditions = (
  definitionCondition?: TradingProviderParamDefinition['condition'],
  providerCondition?: SubBlockCondition
): SubBlockCondition | undefined => {
  if (!definitionCondition) return providerCondition
  if (!providerCondition) return definitionCondition as SubBlockCondition

  const baseCondition = definitionCondition as SubBlockCondition
  const baseAnd = normalizeConditionList(baseCondition.and)

  if (baseAnd.length === 0) {
    return {
      ...baseCondition,
      and: providerCondition,
    }
  }

  return {
    ...baseCondition,
    and: [...baseAnd, providerCondition],
  }
}

const toOptionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const providerParamBlocks = (): SubBlockConfig[] =>
  orderedProviderParamIds
    .map((paramId) => {
      const entry = providerParamRegistry[paramId]
      if (!entry) return null

      const definition = entry.definition
      if (!shouldIncludeProviderParam(definition)) return null

      const inputType = resolveParamInputType(definition)
      const numericInputType =
        (inputType === 'short-input' || inputType === 'long-input') &&
        definition.type === 'number'
          ? 'number'
          : undefined
      const providerCondition = entry.providers.length
        ? ({ field: 'provider', value: entry.providers } as SubBlockCondition)
        : undefined
      const condition = mergeParamConditions(definition.condition, providerCondition)

      return {
        id: paramId,
        title: definition.title || formatParamTitle(paramId),
        type: inputType,
        layout: definition.layout || 'full',
        required: definition.required,
        placeholder: definition.placeholder || definition.description,
        description: definition.description,
        options: definition.options,
        defaultValue: definition.defaultValue,
        fetchOptions: definition.fetchOptions,
        min: definition.min,
        max: definition.max,
        step: definition.step,
        integer: definition.integer,
        rows: definition.rows,
        dependsOn: definition.dependsOn,
        mode: definition.mode,
        inputType: numericInputType,
        password: definition.password ?? isSensitiveParam(paramId),
        condition,
      } as SubBlockConfig
    })
    .filter((block): block is SubBlockConfig => Boolean(block))

const providerCredentialBlocks = (): SubBlockConfig[] => {
  const providers = getTradingProviders()
  return providers
    .filter((provider) => provider.authType === 'oauth' && provider.oauth)
    .map((provider) => {
      const oauth = provider.oauth!
      return {
        id: `${provider.id}Credential`,
        title: oauth.credentialTitle || `${provider.name} Account`,
        type: 'oauth-input',
        layout: 'full',
        required: true,
        provider: oauth.provider,
        serviceId: oauth.serviceId || oauth.provider,
        requiredScopes: oauth.scopes || [],
        placeholder: oauth.credentialPlaceholder || `Select or connect ${provider.name} account`,
        condition: { field: 'provider', value: provider.id },
        canonicalParamId: 'credential',
      }
    })
}

export const TradingActionBlock: BlockConfig<TradingActionResponse> = {
  type: 'trading_action',
  name: 'Trading Action',
  description: 'Place buy/sell orders via Alpaca, Tradier, or Robinhood.',
  authMode: AuthMode.OAuth,
  longDescription:
    'Unified trading action block that supports multiple brokerages with either OAuth or API-key authentication.',
  category: 'tools',
  bgColor: '#ff766e',
  icon: DollarIcon,
  subBlocks: [
    {
      id: 'provider',
      title: 'Broker',
      type: 'dropdown',
      layout: 'full',
      options: providerOptions,
      required: true,
      value: () => 'alpaca',
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Paper (Sandbox)', id: 'paper' },
        { label: 'Live Trading', id: 'live' },
      ],
      condition: providersWithEnvironment.length
        ? { field: 'provider', value: providersWithEnvironment }
        : undefined,
      hidden: providersWithEnvironment.length === 0,
      placeholder: 'Select environment',
      required: false,
    },

    ...providerCredentialBlocks(),
    
    {
      id: 'side',
      title: 'Action',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Buy', id: 'buy' },
        { label: 'Sell', id: 'sell' },
      ],
      required: true,
    },
    {
      id: 'listing',
      title: 'Listing',
      type: 'market-selector',
      layout: 'full',
      providerType: 'trading',
      required: true,
    },
    {
      id: 'orderType',
      title: 'Order Type',
      type: 'dropdown',
      layout: 'half',
      required: true,
      value: () => 'market',
      dependsOn: ['provider'],
      fetchOptions: async (_blockId, _subBlockId, contextValues) => {
        const providerId = contextValues?.provider as string | undefined
        const orderClass =
          (contextValues?.orderClass as string | undefined) ??
          (contextValues?.class as string | undefined)
        return getTradingOrderTypeOptions(providerId, {
          listing: contextValues?.listing,
          orderClass,
        })
      },
    },
    {
      id: 'limitPrice',
      title: 'Limit Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Required for limit/stop-limit and debit/credit/even orders',
      condition: { field: 'orderType', value: ['limit', 'stop_limit', 'debit', 'credit', 'even'] },
    },
    {
      id: 'stopPrice',
      title: 'Stop Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Required for stop/stop-limit orders',
      condition: { field: 'orderType', value: ['stop', 'stop_limit'] },
    },
    {
      id: 'trailPrice',
      title: 'Trail Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Trailing stop price offset (use price or percent)',
      condition: { field: 'orderType', value: 'trailing_stop' },
    },
    {
      id: 'trailPercent',
      title: 'Trail Percent',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Trailing stop percent offset (use percent or price)',
      condition: { field: 'orderType', value: 'trailing_stop' },
    },
    {
      id: 'timeInForce',
      title: 'Time in Force',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Day', id: 'day' },
        { label: 'Good Till Cancelled', id: 'gtc' },
        { label: 'Good For Day (GFD)', id: 'gfd' },
        { label: 'Immediate Or Cancel', id: 'ioc' },
        { label: 'Fill Or Kill', id: 'fok' },
      ],
      placeholder: 'Defaults vary by provider',
    },
    ...providerParamBlocks(),
  ],
  tools: {
    access: ['trading_place_order'],
    config: {
      tool: () => 'trading_place_order',
      params: (params) => {
        const provider = params.provider
        const resolveCredential = () => {
          if (params.credential) return params.credential
          if (provider) {
            const providerKey = `${provider}Credential`
            if (params[providerKey] !== undefined) return params[providerKey]
          }
          return getTradingProviders()
            .map((definition) => params[`${definition.id}Credential`])
            .find((value) => value !== undefined)
        }
        const credential = resolveCredential()
        const extraFields = getTradingProviderParamDefinitions(provider, 'order').reduce(
          (acc, definition) => {
            if (!shouldIncludeProviderParam(definition, TOOL_RESERVED_PARAM_IDS)) return acc
            if (params[definition.id] !== undefined) {
              acc[definition.id] = params[definition.id]
            }
            return acc
          },
          {} as Record<string, any>
        )

        return {
          provider,
          credential,
          environment: params.environment,
          side: params.side,
          listing: params.listing,
          quantity: toOptionalNumber(params.quantity),
          notional: toOptionalNumber(params.notional),
          orderType: params.orderType,
          limitPrice: toOptionalNumber(params.limitPrice),
          stopPrice: toOptionalNumber(params.stopPrice),
          trailPrice: toOptionalNumber(params.trailPrice),
          trailPercent: toOptionalNumber(params.trailPercent),
          timeInForce: params.timeInForce,
          ...extraFields,
        }
      },
    },
  },
  inputs: buildInputsFromToolParams(tradingActionTool.params, {
    include: ['credential'], // include hidden credential to allow wiring while keeping accessToken hidden
  }),
  outputs: {
    summary: { type: 'string', description: 'Order submission status' },
    provider: { type: 'string', description: 'Provider used' },
    order: { type: 'json', description: 'Order payload and raw response' },
  },
}
