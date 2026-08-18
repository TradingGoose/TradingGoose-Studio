/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalCopilotPanel } from '@/global-navbar/global-copilot-panel'

const mocks = vi.hoisted(() => ({
  copilotProps: null as Record<string, unknown> | null,
  currentContext: {
    kind: 'current_monitor',
    monitorId: 'monitor-1',
    workspaceId: 'ws-1',
    label: 'Current monitor',
  } as Record<string, unknown> | null,
}))

vi.mock('@/global-navbar/copilot-context', () => ({
  useGlobalCopilotCurrentContext: () => mocks.currentContext,
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/copilot/components/copilot-app', () => ({
  CopilotApp: (props: Record<string, unknown>) => {
    mocks.copilotProps = props
    return <div data-testid='copilot-app' />
  },
}))

vi.mock('@/lib/copilot/components/copilot/copilot-header', () => ({
  CopilotHeader: () => <div data-testid='copilot-header' />,
  CopilotHeaderActions: () => <div data-testid='copilot-actions' />,
}))

describe('GlobalCopilotPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.copilotProps = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('passes only the page-published object context and keeps the header horizontally scrollable', async () => {
    await act(async () => root.render(<GlobalCopilotPanel workspaceId='ws-1' />))

    const headerScroller = container.querySelector('header > div')
    if (!(headerScroller instanceof HTMLDivElement)) throw new Error('Expected header scroller')
    Object.defineProperties(headerScroller, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 200 },
    })
    await act(async () =>
      headerScroller.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 24 })
      )
    )

    expect(headerScroller.scrollLeft).toBe(24)
    expect(mocks.copilotProps).toEqual(
      expect.objectContaining({ workspaceId: 'ws-1', currentContext: mocks.currentContext })
    )
    expect(mocks.copilotProps).not.toHaveProperty('effectiveParams')
    expect(mocks.copilotProps).not.toHaveProperty('layoutId')
  })
})
