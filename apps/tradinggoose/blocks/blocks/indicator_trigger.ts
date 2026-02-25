import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Activity } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const IndicatorTriggerIcon = (props: SVGProps<SVGSVGElement>) => createElement(Activity, props)

const indicatorTriggerOutputs = {
  input: { type: 'string', description: 'Primary workflow text input.' },
  event: { type: 'string', description: 'Event key passed to trigger(...).' },
  eventId: { type: 'string', description: 'Generated event identifier.' },
  time: { type: 'number', description: 'Bar time in unix seconds.' },
  signal: { type: 'string', description: 'Signal: long, short, flat.' },
  triggerMarker: {
    text: { type: 'string', description: 'Marker label text (event).' },
    position: { type: 'string', description: 'Marker position.' },
    shape: { type: 'string', description: 'Marker shape.' },
    color: { type: 'string', description: 'Marker color.' },
    time: { type: 'number', description: 'Marker time in unix seconds.' },
  },
  marketSeries: {
    listingBase: { type: 'string', description: 'Listing base symbol.' },
    listingQuote: { type: 'string', description: 'Listing quote symbol.' },
    marketCode: { type: 'string', description: 'Market code.' },
    start: { type: 'string', description: 'Series start timestamp.' },
    end: { type: 'string', description: 'Series end timestamp.' },
    timezone: { type: 'string', description: 'Series timezone.' },
    normalizationMode: { type: 'string', description: 'Normalization mode.' },
    bars: { type: 'array', description: 'Market bars array.' },
  },
  indicator: {
    id: { type: 'string', description: 'Indicator id.' },
    name: { type: 'string', description: 'Indicator name.' },
    barIndex: { type: 'number', description: 'Bar index where event emitted.' },
    settings: {
      inputs: { type: 'object', description: 'Resolved indicator inputs.' },
      options: { type: 'object', description: 'Resolved indicator options.' },
      interval: { type: 'string', description: 'Execution interval.' },
      intervalMs: { type: 'number', description: 'Execution interval ms.' },
    },
    output: {
      series: { type: 'array', description: 'Normalized series output.' },
      markers: { type: 'array', description: 'Normalized markers output.' },
      triggers: { type: 'array', description: 'Normalized triggers output.' },
      unsupported: { type: 'object', description: 'Unsupported output metadata.' },
      indicator: { type: 'object', description: 'Indicator options in output.' },
    },
  },
  monitor: {
    id: { type: 'string', description: 'Monitor id (equals internal webhook id).' },
    workflowId: { type: 'string', description: 'Target workflow id.' },
    blockId: { type: 'string', description: 'Target indicator trigger block id.' },
    listing: {
      listing_id: { type: 'string', description: 'Listing id for default listings.' },
      base_id: { type: 'string', description: 'Base id for pair listings.' },
      quote_id: { type: 'string', description: 'Quote id for pair listings.' },
      listing_type: {
        type: 'string',
        description: 'Listing type: default | crypto | currency.',
      },
    },
    providerId: { type: 'string', description: 'Market provider id.' },
    interval: { type: 'string', description: 'Monitor interval.' },
    indicatorId: { type: 'string', description: 'Indicator id used for monitoring.' },
  },
  trigger: {
    provider: { type: 'string', description: 'Trigger provider id.' },
    source: { type: 'string', description: 'Trigger source id.' },
    executionId: { type: 'string', description: 'Execution id.' },
    emittedAt: { type: 'string', description: 'Emit timestamp ISO.' },
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
  subBlocks: [
    {
      id: 'monitorGuidance',
      title: 'Monitor Setup',
      type: 'text',
      mode: 'trigger',
      readOnly: true,
      defaultValue:
        'Manage indicator monitors from Logs → Monitors. This trigger block is read-only and defines available output tags.',
    },
  ],
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
