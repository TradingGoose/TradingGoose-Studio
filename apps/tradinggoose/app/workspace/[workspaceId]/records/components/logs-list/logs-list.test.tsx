/** @vitest-environment jsdom */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CostMetadata, WorkflowLog } from '@/lib/logs/types'
import { LogsList } from './logs-list'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))
vi.mock(
  '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/timeline',
  () => ({ default: () => null })
)

let container: HTMLDivElement
let root: Root
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

it.each<[CostMetadata | undefined, string]>([
  [{ status: 'reported', total: 0.006 }, '$0.0060'],
  [{ status: 'reported', total: 0 }, '$0'],
  [{ status: 'estimated', total: 0.006 }, 'Estimated $0.0060'],
  [{ estimated: true, total: 0.006 }, 'Estimated $0.0060'],
  [{ status: 'partial', availableTotal: 0.002 }, 'Unavailable (available: $0.0020)'],
  [
    { status: 'partial', availableTotal: 0.002, estimated: true },
    'Estimated Unavailable (estimated available: $0.0020)',
  ],
  [{ status: 'partial', availableTotal: 0 }, 'Unavailable (available: $0)'],
  [{ status: 'unavailable', availableTotal: 0.000001 }, 'Unavailable (available: $0.000001000)'],
  [{ status: 'unavailable' }, 'Unavailable (available: Unavailable)'],
  [{ status: 'reported', total: Number.NaN }, 'Unavailable'],
  [undefined, 'Unavailable'],
])(
  'shows honest native cost status and available amounts in records (%j)',
  async (cost, expected) => {
    const log = {
      id: 'log',
      createdAt: '2026-11-07T00:00:00Z',
      level: 'info',
      workflow: { name: 'Native model workflow' },
      cost,
    } as WorkflowLog
    const onLogClick = vi.fn()
    await act(async () => {
      root.render(
        <LogsList
          logs={[log]}
          selectedLogId={null}
          onLogClick={onLogClick}
          loading={false}
          failureMode={null}
          hasMore={false}
          isFetchingMore={false}
          loaderRef={createRef()}
          scrollContainerRef={createRef()}
          selectedRowRef={createRef()}
        />
      )
    })
    const row = container.querySelector('tbody tr')!
    expect(row.querySelectorAll('td')[3].textContent).toBe(expected)
    await act(async () => (row as HTMLTableRowElement).click())
    expect(onLogClick).toHaveBeenCalledWith(log)
  }
)
