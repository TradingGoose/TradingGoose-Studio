/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
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

vi.mock('./kanban', () => ({
  KanbanBoardProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  KanbanBoard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  KanbanColumns: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  KanbanColumn: ({ children, title }: { children: ReactNode; title: string }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  KanbanColumnList: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  KanbanColumnListItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  KanbanCard: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <div role='button' tabIndex={0} onClick={onClick}>
      {children}
    </div>
  ),
  useDndEvents: () => ({
    draggableDescribedById: 'monitor-board-test',
    onDragStart: vi.fn(),
    onDragMove: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnd: vi.fn(),
    onDragCancel: vi.fn(),
  }),
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

describe('MonitorBoard', () => {
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

  it('hides the interval when the visible field is disabled', async () => {
    await act(async () => {
      root.render(
        <MonitorBoard
          columns={[
            {
              id: 'running',
              label: 'Running',
              items: [baseEntity],
            },
          ]}
          groupBy='status'
          visibleFields={{
            ...DEFAULT_MONITOR_VIEW_CONFIG.visibleFields,
            interval: false,
          }}
          selectedMonitorId={null}
          togglingMonitorId={null}
          deletingMonitorId={null}
          onSelectMonitor={vi.fn()}
          onEditMonitor={vi.fn()}
          onToggleMonitorState={vi.fn()}
          onDeleteMonitor={vi.fn()}
          onMoveMonitorStatus={vi.fn()}
          onUpdateStatusBoardCardOrder={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('RSI')
    expect(container.textContent).not.toContain('1m')
  })

  it('renders an empty kanban surface when there are no columns', async () => {
    await act(async () => {
      root.render(
        <MonitorBoard
          columns={[]}
          groupBy='workflow'
          visibleFields={DEFAULT_MONITOR_VIEW_CONFIG.visibleFields}
          selectedMonitorId={null}
          togglingMonitorId={null}
          deletingMonitorId={null}
          onSelectMonitor={vi.fn()}
          onEditMonitor={vi.fn()}
          onToggleMonitorState={vi.fn()}
          onDeleteMonitor={vi.fn()}
          onMoveMonitorStatus={vi.fn()}
          onUpdateStatusBoardCardOrder={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('No monitors are available for the current Kanban view.')
  })
})
