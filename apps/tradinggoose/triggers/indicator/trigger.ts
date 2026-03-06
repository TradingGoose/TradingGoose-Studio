import type { TriggerConfig } from '@/triggers/types'

export const indicatorTrigger: TriggerConfig = {
  id: 'indicator_trigger',
  name: 'Indicator Trigger',
  provider: 'indicator',
  description: 'Trigger workflow from indicator monitor events',
  version: '1.0.0',
  subBlocks: [
    {
      id: 'triggerInstructions',
      title: 'Setup',
      type: 'text',
      mode: 'trigger',
      defaultValue:
        'Indicator monitors are managed from Logs → Monitors. Configure provider, listing, interval, indicator, and workflow target there.',
      readOnly: true,
    },
  ],
  outputs: {
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
  },
}
