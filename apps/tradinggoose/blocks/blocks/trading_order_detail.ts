import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { buildInputsFromToolParams, requiredUserOnlyInput } from '@/blocks/utils'
import { getTradingProviders } from '@/providers/trading'
import { tradingOrderDetailTool } from '@/tools/trading/order_detail'
import type { TradingOrderDetailResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

const providerCredentialBlocks = (): SubBlockConfig[] => {
  const providers = getTradingProviders()
  return providers
    .filter((provider) => provider.authType === 'oauth' && provider.oauth)
    .map((provider) => {
      const oauth = provider.oauth!
      const serviceIds = oauth.credentialServices?.map((service) => service.serviceId) ?? []
      return {
        id: `${provider.id}Credential`,
        title: oauth.credentialTitle || `${provider.name} Account`,
        type: 'oauth-input',
        layout: 'full',
        required: true,
        provider: oauth.provider,
        ...(serviceIds.length === 1 ? { serviceId: serviceIds[0] } : { serviceIds }),
        requiredScopes: oauth.scopes || [],
        placeholder: oauth.credentialPlaceholder || `Select or connect ${provider.name} account`,
        condition: { field: 'provider', value: provider.id },
        canonicalParamId: 'credential',
      }
    })
}

export const TradingOrderDetailBlock: BlockConfig<TradingOrderDetailResponse> = {
  type: 'trading_order_detail',
  name: 'Order Detail',
  description: 'Retrieve provider-side details for a previously submitted trading order.',
  authMode: AuthMode.OAuth,
  longDescription:
    'Looks up the Trading Goose order history record by order ID, resolves the provider order ID, and fetches the latest provider order detail.',
  category: 'tools',
  bgColor: '#0f766e',
  icon: DollarIcon,
  subBlocks: [
    {
      id: 'orderId',
      title: 'Order ID',
      type: 'order-id-selector',
      layout: 'full',
      placeholder: 'Search by order ID, symbol, ticker, quote, or date',
      required: true,
    },
    {
      id: 'provider',
      title: 'Broker',
      type: 'dropdown',
      layout: 'full',
      options: providerOptions,
      required: true,
      placeholder: 'Select the broker used for this order',
    },
    ...providerCredentialBlocks(),
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      layout: 'full',
      required: false,
      placeholder: 'Optional Tradier account ID override',
      condition: { field: 'provider', value: 'tradier' },
    },
  ],
  tools: {
    access: ['trading_order_detail'],
    config: {
      tool: () => 'trading_order_detail',
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

        return {
          orderId: params.orderId,
          provider,
          credential: resolveCredential(),
          accountId: params.accountId,
        }
      },
    },
  },
  inputs: {
    ...buildInputsFromToolParams(tradingOrderDetailTool.params, {
      include: ['credential'],
    }),
    provider: requiredUserOnlyInput('string', 'Trading provider id used for this order.'),
    credential: requiredUserOnlyInput(
      'string',
      'OAuth credential id selected by the broker account field.'
    ),
  },
  outputs: {
    summary: { type: 'string', description: 'Status of order detail retrieval.' },
    provider: { type: 'string', description: 'Provider used for the order detail request.' },
    appOrderId: { type: 'string', description: 'Trading Goose order ID.' },
    providerOrderId: { type: 'string', description: 'Provider order ID.' },
    workspaceId: { type: 'string', description: 'Workspace that owns the recorded order.' },
    logId: {
      type: 'string',
      description: 'Linked log ID, when one exists.',
    },
    orderDetail: { type: 'json', description: 'Normalized order detail payload.' },
  },
}
