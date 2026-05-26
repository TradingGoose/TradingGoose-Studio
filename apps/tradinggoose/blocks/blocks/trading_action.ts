import { DollarIcon } from '@/components/icons/icons'
import type { ListingInputValue } from '@/lib/listing/identity'
import type { BlockConfig, SubBlockCondition } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import {
  buildInputsFromToolParams,
  fetchTradingPortfolioIdentityOptions,
  fetchTradingProviderOptionsByKind,
  requiredUserOnlyInput,
} from '@/blocks/utils'
import {
  getTradingOrderSizingModeDefinitions,
  getTradingOrderTimeInForceOptions,
  getTradingOrderTypeOptions,
  tradingOrderTypeUsesField,
} from '@/providers/trading/order-types'
import type { TradingOrderTypeRequirement } from '@/providers/trading/providers'
import {
  getTradingOrderCapabilities,
  getTradingProvidersByKind,
} from '@/providers/trading/providers'
import type { TradingActionResponse, TradingProviderId } from '@/providers/trading/types'
import { buildOrderRoutePayload, tradingActionTool } from '@/tools/trading/action'

const TRADING_PROVIDER_FIELD = 'provider'

const resolveContextValue = (
  contextValues: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const entry = contextValues?.[key]
  return typeof entry === 'string' ? entry || undefined : undefined
}

const orderProviders = getTradingProvidersByKind('order')
const fetchOrderProviderOptions = fetchTradingProviderOptionsByKind('order')

const providerIdsWith = (predicate: (provider: (typeof orderProviders)[number]) => boolean) =>
  orderProviders.filter(predicate).map((provider) => provider.id)

const conditionFor = (
  field: string,
  values: string[],
  providerIds?: string[]
): SubBlockCondition | undefined => {
  if (!values.length) return undefined
  const condition: SubBlockCondition = { field, value: values }
  return providerIds?.length
    ? { ...condition, and: { field: TRADING_PROVIDER_FIELD, value: providerIds } }
    : condition
}

const sizingModeProviderIds = providerIdsWith(
  (provider) => (getTradingOrderCapabilities(provider.id)?.sizingModes ?? []).length > 1
)
const quantityProviderIds = providerIdsWith((provider) =>
  (getTradingOrderCapabilities(provider.id)?.sizingModes ?? []).some(
    (definition) => definition.id === 'quantity'
  )
)
const notionalProviderIds = providerIdsWith((provider) =>
  (getTradingOrderCapabilities(provider.id)?.sizingModes ?? []).some(
    (definition) => definition.id === 'notional'
  )
)
const previewProviderIds = providerIdsWith(
  (provider) => getTradingOrderCapabilities(provider.id)?.preview === true
)

const orderTypeCapability = (field: TradingOrderTypeRequirement) => {
  const providerIds = providerIdsWith((provider) =>
    (getTradingOrderCapabilities(provider.id)?.orderTypes ?? []).some((definition) =>
      tradingOrderTypeUsesField(definition, field)
    )
  )
  const values = Array.from(
    new Set(
      orderProviders.flatMap((provider) =>
        (getTradingOrderCapabilities(provider.id)?.orderTypes ?? [])
          .filter((definition) => tradingOrderTypeUsesField(definition, field))
          .map((definition) => definition.id)
      )
    )
  )
  return conditionFor('orderType', values, providerIds)
}

const quantityConditionBase = conditionFor('orderSizingMode', ['notional'], quantityProviderIds)
const quantityCondition = quantityConditionBase
  ? { ...quantityConditionBase, not: true }
  : undefined
const sizingModeCondition = conditionFor(TRADING_PROVIDER_FIELD, sizingModeProviderIds)
const notionalCondition = conditionFor('orderSizingMode', ['notional'], notionalProviderIds)
const previewCondition = conditionFor(TRADING_PROVIDER_FIELD, previewProviderIds)
const limitPriceCondition = orderTypeCapability('limitPrice')
const stopPriceCondition = orderTypeCapability('stopPrice')
const trailPriceCondition = orderTypeCapability('trailPrice')
const trailPercentCondition = orderTypeCapability('trailPercent')

export const TradingActionBlock: BlockConfig<TradingActionResponse> = {
  type: 'trading_action',
  name: 'Trading Action',
  description: 'Place buy/sell orders via Alpaca or Tradier.',
  authMode: AuthMode.OAuth,
  longDescription:
    'Unified trading action block that submits orders from a selected broker account.',
  category: 'tools',
  bgColor: '#ff766e',
  icon: DollarIcon,
  subBlocks: [
    {
      id: TRADING_PROVIDER_FIELD,
      title: 'Broker',
      type: 'dropdown',
      layout: 'full',
      options: [],
      fetchOptions: fetchOrderProviderOptions,
      placeholder: 'Select broker',
      required: true,
    },
    {
      id: 'portfolioIdentity',
      title: 'Broker Account',
      type: 'dropdown',
      layout: 'full',
      required: true,
      dependsOn: [TRADING_PROVIDER_FIELD],
      enableSearch: true,
      autoSelectFirstOption: false,
      placeholder: 'Select broker account',
      description: 'Broker account used to submit this order.',
      fetchOptions: fetchTradingPortfolioIdentityOptions,
    },
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
      providerType: 'market',
      required: true,
    },
    {
      id: 'orderSizingMode',
      title: 'Order Size',
      type: 'dropdown',
      layout: 'half',
      condition: sizingModeCondition,
      dependsOn: [TRADING_PROVIDER_FIELD],
      fetchOptions: async (_blockId, _subBlockId, context) => {
        const contextValues = context.contextValues as Record<string, unknown> | undefined
        const providerId = resolveContextValue(contextValues, TRADING_PROVIDER_FIELD)
        return getTradingOrderSizingModeDefinitions(providerId).map((definition) => ({
          id: definition.id,
          label: definition.label,
        }))
      },
    },
    {
      id: 'quantity',
      title: 'Quantity',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Quantity to trade',
      condition: quantityCondition,
    },
    {
      id: 'notional',
      title: 'Notional',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Dollar amount',
      condition: notionalCondition,
    },
    {
      id: 'orderType',
      title: 'Order Type',
      type: 'dropdown',
      layout: 'half',
      required: true,
      value: () => 'market',
      dependsOn: [TRADING_PROVIDER_FIELD, 'listing'],
      fetchOptions: async (_blockId, _subBlockId, context) => {
        const contextValues = context.contextValues as Record<string, unknown> | undefined
        const providerId = resolveContextValue(contextValues, TRADING_PROVIDER_FIELD) as
          | TradingProviderId
          | undefined
        const listing = contextValues?.listing as ListingInputValue | undefined
        return getTradingOrderTypeOptions(providerId, { listing })
      },
    },
    {
      id: 'preview',
      title: 'Preview Order',
      type: 'switch',
      layout: 'half',
      condition: previewCondition,
    },
    {
      id: 'limitPrice',
      title: 'Limit Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Required for limit and stop-limit orders',
      condition: limitPriceCondition,
    },
    {
      id: 'stopPrice',
      title: 'Stop Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Required for stop/stop-limit orders',
      condition: stopPriceCondition,
    },
    {
      id: 'trailPrice',
      title: 'Trail Price',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Trailing stop price offset (use price or percent)',
      condition: trailPriceCondition,
    },
    {
      id: 'trailPercent',
      title: 'Trail Percent',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Trailing stop percent offset (use percent or price)',
      condition: trailPercentCondition,
    },
    {
      id: 'timeInForce',
      title: 'Time in Force',
      type: 'dropdown',
      layout: 'half',
      dependsOn: [TRADING_PROVIDER_FIELD],
      fetchOptions: async (_blockId, _subBlockId, context) => {
        const contextValues = context.contextValues as Record<string, unknown> | undefined
        return getTradingOrderTimeInForceOptions(
          resolveContextValue(contextValues, TRADING_PROVIDER_FIELD)
        ).map((id) => ({
          id,
          label: id.toUpperCase(),
        }))
      },
      placeholder: 'Defaults vary by provider',
    },
  ],
  tools: {
    access: ['trading_place_order'],
    config: {
      tool: () => 'trading_place_order',
      params: (params) => buildOrderRoutePayload(params),
    },
  },
  inputs: {
    ...buildInputsFromToolParams(tradingActionTool.params, {
      include: ['portfolioIdentity'],
    }),
    portfolioIdentity: requiredUserOnlyInput(
      'json',
      'Canonical portfolioIdentity selected by the broker account field.'
    ),
  },
  outputs: {
    summary: { type: 'string', description: 'Order submission status' },
    provider: { type: 'string', description: 'Provider used' },
    appOrderId: { type: 'string', description: 'Trading Goose order ID' },
    clientOrderId: { type: 'string', description: 'Broker client order identity' },
    order: { type: 'json', description: 'Order payload and raw response' },
  },
}
