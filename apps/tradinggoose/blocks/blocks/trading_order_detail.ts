import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { buildInputsFromToolParams, requiredUserOnlyInput } from '@/blocks/utils'
import { getTradingProviders } from '@/providers/trading'
import { tradingOrderDetailTool } from '@/tools/trading/order_detail'
import type { TradingOrderDetailResponse } from '@/tools/trading/types'

const providerOptions = getTradingProviders().map((provider) => ({
  label: provider.name,
  id: provider.id,
}))

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
  ],
  tools: {
    access: ['trading_order_detail'],
    config: {
      tool: () => 'trading_order_detail',
      params: (params) => ({
        orderId: params.orderId,
        provider: params.provider,
      }),
    },
  },
  inputs: {
    ...buildInputsFromToolParams(tradingOrderDetailTool.params),
    provider: requiredUserOnlyInput('string', 'Trading provider id used for this order.'),
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
