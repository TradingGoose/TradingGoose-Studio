/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThinkingGroup } from './thinking-group'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('ThinkingGroup', () => {
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

  it('shows a streaming header while thinking and a finalized duration after completion', async () => {
    const blocks = [
      {
        type: 'thinking' as const,
        content: 'Inspecting the workflow.\nPreparing the update.',
        timestamp: 1,
        itemId: 'thinking-1',
        duration: 1250,
        startTime: 100,
      },
    ]

    await act(async () => {
      root.render(<ThinkingGroup blocks={blocks} isStreaming={true} />)
    })

    expect(container.textContent).toContain('Thinking...')
    expect(container.textContent).toContain('Inspecting the workflow.')

    await act(async () => {
      root.render(<ThinkingGroup blocks={blocks} isStreaming={false} />)
    })

    expect(container.textContent).toContain('Thought for 1.3s')
    expect(container.textContent).not.toContain('Thinking...')
  })
})
