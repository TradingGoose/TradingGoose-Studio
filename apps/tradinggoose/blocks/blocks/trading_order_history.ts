import { DollarIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import { buildInputsFromToolParams } from '@/blocks/utils'
import { orderHistoryTool } from '@/tools/trading'
import type { OrderHistoryResponse } from '@/tools/trading/order_history'

export const TradingOrderHistoryBlock: BlockConfig<OrderHistoryResponse> = {
  type: 'trading_order_history',
  name: 'Trading Order History',
  description: 'Retrieve recorded trading order submissions for a date range.',
  longDescription:
    'Fetches order submission history recorded by the Trading Action tool for the selected date range.',
  category: 'tools',
  bgColor: '#0f766e',
  icon: DollarIcon,
  subBlocks: [
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'datetime-input',
      layout: 'full',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      required: true,
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'datetime-input',
      layout: 'full',
      placeholder: 'YYYY-MM-DDTHH:mm:ssZ',
      required: true,
    },
  ],
  tools: {
    access: ['trading_order_history'],
    config: {
      tool: () => 'trading_order_history',
      params: (params) => ({
        startDate: params.startDate,
        endDate: params.endDate,
      }),
    },
  },
  inputs: buildInputsFromToolParams(orderHistoryTool.params),
  outputs: {
    history: { type: 'array', description: 'Order submissions recorded in the date range.' },
    count: { type: 'number', description: 'Number of records returned.' },
    startDate: { type: 'string', description: 'Start datetime used for filtering.' },
    endDate: { type: 'string', description: 'End datetime used for filtering.' },
    workspaceId: { type: 'string', description: 'Workspace ID used for filtering.' },
  },
}
