import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Activity } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const IndicatorTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Activity, props)

const indicatorTriggerOutputs = {
  input: { type: 'string', description: 'Primary workflow text input.' },
  event: { type: 'string', description: 'Event key passed to trigger(...).' },
  time: { type: 'number', description: 'Bar time in unix seconds.' },
  signal: { type: 'string', description: 'Signal: long, short, flat.' },
  listingBase: { type: 'string', description: 'Listing base value from market series.' },
  listingQuote: { type: 'string', description: 'Listing quote value from market series.' },
  marketSeries: {
    type: 'json',
    description: 'Market historical series data.',
  },
  listing: {
    type: 'json',
    description: 'Listing information.',
  },
  indicator: {
    name: { type: 'string', description: 'Indicator name.' },
    settings: {
      options: { type: 'object', description: 'Resolved indicator options.' },
      interval: { type: 'string', description: 'Execution interval.' },
    },
    output: {
      series: { type: 'array', description: 'Normalized series output.' },
    },
  },
}

export const IndicatorTriggerBlock: BlockConfig = {
  type: 'indicator_trigger',
  name: 'Indicator Monitor',
  description: 'Trigger workflow from indicator monitor events managed in Logs → Monitors.',
  category: 'triggers',
  icon: IndicatorTriggerIcon,
  bgColor: '#16A34A',
  triggerAllowed: true,
  bestPractices: `
  - Configure and manage monitors in Logs > Monitors.
  - Use this trigger block to expose monitor payload fields to downstream blocks.
  - Keep monitor/provider/auth/listing settings out of workflow trigger subblocks.
  `,
  subBlocks: [...(getTrigger('indicator_trigger')?.subBlocks ?? [])],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: indicatorTriggerOutputs as unknown as BlockConfig['outputs'],
  triggers: {
    enabled: true,
    available: ['indicator_trigger'],
  },
}
