/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitorBoard } from './monitor-board'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('MonitorBoard interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders dnd-kit draggable cards and supports keyboard reordering', async () => {
    const onReorderColumnCards = vi.fn()

    const items = ['log-1', 'log-2'].map((logId, index) => ({
      logId,
      workflowId: 'wf-1',
      executionId: `exec-${index + 1}`,
      startedAt: '2026-04-23T00:00:00.000Z',
      endedAt: '2026-04-23T00:05:00.000Z',
      durationMs: 300000,
      outcome: 'success' as const,
      trigger: 'manual',
      workflowName: 'Workflow One',
      workflowColor: '#3972F6',
      monitorId: 'monitor-1',
      providerId: 'alpaca',
      interval: '1m',
      indicatorId: 'rsi',
      assetType: 'stock',
      listing: null,
      listingLabel: logId,
      cost: 0.2,
      isOrphaned: false,
      isPartial: false,
      sourceLog: {
        id: logId,
        workspaceId: 'workspace-1',
        workflowId: 'wf-1',
        executionId: `exec-${index + 1}`,
        level: 'info',
        trigger: 'manual',
        startedAt: '2026-04-23T00:00:00.000Z',
        recordCreatedAt: '2026-04-23T00:00:00.000Z',
        endedAt: '2026-04-23T00:05:00.000Z',
        durationMs: 300000,
        outcome: 'success' as const,
      },
    }))

    await act(async () => {
      root.render(
        <MonitorBoard
          sections={[
            {
              id: 'all',
              label: 'All executions',
              columns: [
                {
                  id: 'success',
                  fieldId: 'success',
                  label: 'Success',
                  totalCount: 2,
                  aggregates: { count: 2 },
                  limit: null,
                  items,
                },
              ],
            },
          ]}
          selectedExecutionLogId={null}
          visibleFieldIds={['workflow']}
          timezone='UTC'
          canReorder
          onSelectExecution={vi.fn()}
          onToggleQuickFilter={vi.fn()}
          isQuickFilterActive={() => false}
          onReorderColumnCards={onReorderColumnCards}
        />
      )
    })

    const cards = Array.from(container.querySelectorAll('article'))

    if (!(cards[0] instanceof HTMLElement)) {
      throw new Error('Expected draggable card to render')
    }

    expect(cards[0].getAttribute('aria-roledescription')).toBe('draggable')
    expect(cards[0].getAttribute('draggable')).toBeNull()

    await act(async () => {
      cards[0]!.focus()
      cards[0]!.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'ArrowDown',
        })
      )
    })

    expect(onReorderColumnCards).toHaveBeenCalledWith('success', ['log-2', 'log-1'])
  })
})
