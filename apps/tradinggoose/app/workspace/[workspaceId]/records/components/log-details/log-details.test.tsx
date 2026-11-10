/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LogDetails } from './log-details'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}))
vi.mock('./components/execution-snapshot/frozen-canvas-modal', () => ({
  FrozenCanvasModal: () => null,
}))
vi.mock('./components/trace-spans/trace-spans', () => ({ TraceSpans: () => null }))
vi.mock('./components/file-download/file-download', () => ({ FileDownload: () => null }))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

it.each([
  [
    { status: 'partial', availableTotal: 0.002, estimated: true },
    'Unavailable (estimated available: $0.0020)',
  ],
  [{ status: 'partial', availableTotal: 0.002 }, 'Unavailable (available: $0.0020)'],
  [
    { status: 'partial', availableTotal: 0, estimated: true },
    'Unavailable (estimated available: $0)',
  ],
  [{ status: 'reported', total: 0 }, '$0'],
  [{ status: 'unavailable' }, 'Unavailable'],
])('displays per-model available costs and estimate labels (%j)', async (cost, expected) => {
  await act(async () => {
    root.render(
      <LogDetails
        isOpen
        onClose={() => {}}
        log={
          {
            id: 'log',
            createdAt: '2026-11-07T00:00:00Z',
            cost: { models: { 'native/test': cost } },
          } as any
        }
      />
    )
  })
  await act(async () => {
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('modelBreakdown'))!
      .click()
  })
  const model = Array.from(container.querySelectorAll('div')).find(
    (element) => element.textContent === 'native/test'
  )!.parentElement!
  const total = Array.from(model.querySelectorAll('div')).find(
    (element) => element.firstElementChild?.textContent === 'total'
  )!
  expect(total.lastElementChild?.textContent).toBe(expected)
})
