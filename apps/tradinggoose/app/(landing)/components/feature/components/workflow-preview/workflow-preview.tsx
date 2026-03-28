'use client'

import { ChevronDown, Workflow } from 'lucide-react'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { widgetHeaderControlClassName } from '@/widgets/widgets/components/widget-header-control'
import { LandingWidgetShell } from '../market-preview/landing-widget-shell'
import { WorkflowPreviewCanvas } from './workflow-preview-canvas'

const WORKFLOW_SELECTOR = {
  name: 'Momentum Breakout',
  color: '#8b5cf6',
} as const

const WORKFLOW_STATE: WorkflowState = {
  blocks: {
    market: {
      id: 'market',
      type: 'historical_data',
      name: 'Market Data',
      position: { x: 24, y: 44 },
      subBlocks: {
        provider: { id: 'provider', type: 'dropdown', value: 'polygon' },
        listing: { id: 'listing', type: 'market-selector', value: 'AAPL' },
        interval: { id: 'interval', type: 'dropdown', value: '1m' },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      height: 168,
    },
    filter: {
      id: 'filter',
      type: 'condition',
      name: 'Entry Filter',
      position: { x: 420, y: 50 },
      subBlocks: {
        conditions: {
          id: 'conditions',
          type: 'condition-input',
          value: JSON.stringify([
            { id: 'long-setup', value: 'ema_21 > ema_50 && macd_histogram > 0' },
            { id: 'else-path', value: '' },
          ]),
        },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      height: 152,
    },
    trade: {
      id: 'trade',
      type: 'trading_action',
      name: 'Place Order',
      position: { x: 812, y: 44 },
      subBlocks: {
        provider: { id: 'provider', type: 'dropdown', value: 'alpaca' },
        environment: { id: 'environment', type: 'dropdown', value: 'paper' },
        side: { id: 'side', type: 'dropdown', value: 'buy' },
        listing: { id: 'listing', type: 'market-selector', value: 'AAPL' },
        orderType: { id: 'orderType', type: 'dropdown', value: 'market' },
        timeInForce: { id: 'timeInForce', type: 'dropdown', value: 'day' },
      },
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      height: 188,
    },
  },
  edges: [
    {
      id: 'market-filter',
      source: 'market',
      sourceHandle: 'source',
      target: 'filter',
      targetHandle: 'target',
      type: 'workflowEdge',
    },
    {
      id: 'filter-trade',
      source: 'filter',
      sourceHandle: 'condition-long-setup',
      target: 'trade',
      targetHandle: 'target',
      type: 'workflowEdge',
    },
  ],
  loops: {},
  parallels: {},
}

function WorkflowSelectorMock() {
  return (
    <button
      type='button'
      className={widgetHeaderControlClassName(
        'group flex min-w-[240px] items-center justify-between gap-1'
      )}
      aria-label={WORKFLOW_SELECTOR.name}
    >
      <div
        className='h-5 w-5 rounded-xs p-0.5'
        style={{
          backgroundColor: `${WORKFLOW_SELECTOR.color}20`,
        }}
        aria-hidden='true'
      >
        <Workflow
          className='h-4 w-4'
          aria-hidden='true'
          style={{ color: WORKFLOW_SELECTOR.color }}
        />
      </div>
      <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
        {WORKFLOW_SELECTOR.name}
      </span>
      <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' aria-hidden='true' />
    </button>
  )
}

export function WorkflowPreview() {
  return (
    <div className='flex h-full min-h-[480px] flex-col gap-4'>
      <LandingWidgetShell
        widgetKey='editor_workflow'
        className='min-h-0 flex-1'
        headerCenter={<WorkflowSelectorMock />}
      >
        <WorkflowPreviewCanvas workflowState={WORKFLOW_STATE} className='h-full w-full flex-1' />
      </LandingWidgetShell>
    </div>
  )
}
