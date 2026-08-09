// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { StatusDisplay } from './status-display'

vi.mock('@/i18n/workspace-widget-hooks', () => ({
  useWorkflowConsoleMessages: () => ({ running: 'Running', canceled: 'Canceled', failed: 'Failed' }),
}))

describe('StatusDisplay', () => {
  it('shows a failed terminal state instead of a duration', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <StatusDisplay
          isRunning={false}
          isCanceled={false}
          hasError={true}
          formattedDuration='20s'
        />
      )
    })

    expect(container.textContent).toBe('Failed')
    await act(async () => root.unmount())
  })
})
