/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorEntity } from './board-state'
import { MonitorBoard } from './monitor-board'
import { DEFAULT_MONITOR_VIEW_CONFIG } from './view-config'

vi.mock('@/components/listing-selector/listing/row', () => ({
  MarketListingRow: ({
    listing,
  }: {
    listing?: { base?: string | null; quote?: string | null } | null
  }) => <div>{listing?.base ?? 'Listing'}</div>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    className,
    variant,
  }: {
    children?: ReactNode
    className?: string
    variant?: string
  }) => (
    <span data-class-name={className} data-variant={variant}>
      {children}
    </span>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const baseEntity: MonitorEntity = {
  id: 'monitor-1',
  monitor: {
    monitorId: 'monitor-1',
    workflowId: 'wf-1',
    blockId: 'trigger-a',
    isActive: true,
    providerConfig: {
      triggerId: 'indicator_trigger',
      version: 1,
      monitor: {
        providerId: 'alpaca',
        interval: '1m',
        listing: {
          listing_id: 'AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
        indicatorId: 'rsi',
        auth: {
          hasEncryptedSecrets: true,
          encryptedSecretFieldIds: ['apiKey'],
        },
      },
    },
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
  },
  workflowName: 'Momentum',
  workflowColor: '#3972F6',
  workflowTarget: null,
  indicatorName: 'RSI',
  indicatorColor: '#ff6600',
  providerName: 'Alpaca',
  providerIcon: undefined,
  triggerId: 'indicator_trigger',
  triggerName: 'Indicator Trigger',
  listingOption: {
    listing_id: 'AAPL',
    base_id: '',
    quote_id: '',
    listing_type: 'default',
    base: 'AAPL',
    quote: null,
    name: null,
    iconUrl: null,
    assetClass: null,
    countryCode: null,
  },
  listingLabel: 'AAPL',
  listingSortKey: 'aapl',
  assetTypeKey: 'stock',
  assetTypeLabel: 'STOCK',
  primaryStatus: 'running',
  secondaryStatuses: [],
  authConfigured: true,
  needsDeploy: false,
  canPause: true,
  canResume: false,
  updatedAtDate: new Date('2026-04-22T00:00:00.000Z'),
  createdAtDate: new Date('2026-04-20T00:00:00.000Z'),
}

const dispatchKey = (element: Element, key: string) => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

const getColumnText = (container: HTMLDivElement, title: string) => {
  const heading = Array.from(container.querySelectorAll('h2')).find((node) => node.textContent === title)
  const section = heading?.closest('section')
  return section?.textContent ?? ''
}

describe('MonitorBoard keyboard drag and drop', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('previews a keyboard status move and only commits on drop', async () => {
    const onMoveMonitorStatus = vi.fn()
    const onUpdateStatusBoardCardOrder = vi.fn()

    await act(async () => {
      root.render(
        <MonitorBoard
          columns={[
            { id: 'running', label: 'Running', items: [baseEntity] },
            { id: 'paused', label: 'Paused', items: [] },
          ]}
          groupBy='status'
          visibleFields={DEFAULT_MONITOR_VIEW_CONFIG.visibleFields}
          selectedMonitorId={null}
          togglingMonitorId={null}
          deletingMonitorId={null}
          onSelectMonitor={vi.fn()}
          onEditMonitor={vi.fn()}
          onToggleMonitorState={vi.fn()}
          onDeleteMonitor={vi.fn()}
          onMoveMonitorStatus={onMoveMonitorStatus}
          onUpdateStatusBoardCardOrder={onUpdateStatusBoardCardOrder}
        />
      )
    })

    const card = container.querySelector('article[role="button"]')

    expect(card).not.toBeNull()

    await act(async () => {
      dispatchKey(card!, ' ')
    })

    await act(async () => {
      dispatchKey(card!, 'ArrowRight')
    })

    expect(getColumnText(container, 'Running')).not.toContain('AAPL')
    expect(getColumnText(container, 'Paused')).toContain('AAPL')
    expect(onMoveMonitorStatus).not.toHaveBeenCalled()
    expect(onUpdateStatusBoardCardOrder).not.toHaveBeenCalled()

    const previewCard = container.querySelector('article[role="button"]')

    expect(previewCard).not.toBeNull()

    await act(async () => {
      dispatchKey(previewCard!, 'Enter')
    })

    expect(onMoveMonitorStatus).toHaveBeenCalledTimes(1)
    expect(onMoveMonitorStatus).toHaveBeenCalledWith(baseEntity.monitor, 'paused')
    expect(onUpdateStatusBoardCardOrder).toHaveBeenCalledTimes(1)
    expect(onUpdateStatusBoardCardOrder).toHaveBeenCalledWith(['monitor-1'])
  })

  it('restores the original board when a keyboard drag is cancelled', async () => {
    const onMoveMonitorStatus = vi.fn()
    const onUpdateStatusBoardCardOrder = vi.fn()

    await act(async () => {
      root.render(
        <MonitorBoard
          columns={[
            { id: 'running', label: 'Running', items: [baseEntity] },
            { id: 'paused', label: 'Paused', items: [] },
          ]}
          groupBy='status'
          visibleFields={DEFAULT_MONITOR_VIEW_CONFIG.visibleFields}
          selectedMonitorId={null}
          togglingMonitorId={null}
          deletingMonitorId={null}
          onSelectMonitor={vi.fn()}
          onEditMonitor={vi.fn()}
          onToggleMonitorState={vi.fn()}
          onDeleteMonitor={vi.fn()}
          onMoveMonitorStatus={onMoveMonitorStatus}
          onUpdateStatusBoardCardOrder={onUpdateStatusBoardCardOrder}
        />
      )
    })

    const card = container.querySelector('article[role="button"]')

    expect(card).not.toBeNull()

    await act(async () => {
      dispatchKey(card!, ' ')
    })

    await act(async () => {
      dispatchKey(card!, 'ArrowRight')
    })

    const previewCard = container.querySelector('article[role="button"]')

    expect(previewCard).not.toBeNull()

    await act(async () => {
      dispatchKey(previewCard!, 'Escape')
    })

    expect(getColumnText(container, 'Running')).toContain('AAPL')
    expect(getColumnText(container, 'Paused')).not.toContain('AAPL')
    expect(onMoveMonitorStatus).not.toHaveBeenCalled()
    expect(onUpdateStatusBoardCardOrder).not.toHaveBeenCalled()
  })
})
