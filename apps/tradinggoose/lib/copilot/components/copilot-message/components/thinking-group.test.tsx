/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThinkingGroup } from './thinking-group'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
type ThinkingBlock = ComponentProps<typeof ThinkingGroup>['blocks'][number]

const thinkingBlock = (overrides: Partial<ThinkingBlock> = {}): ThinkingBlock => ({
  type: 'thinking',
  content: 'Historical reasoning.',
  timestamp: 1,
  ...overrides,
})

describe('ThinkingGroup', () => {
  let container: HTMLDivElement
  let root: Root

  const renderGroup = async (blocks: ThinkingBlock[], isStreaming = false) => {
    await act(async () => root.render(<ThinkingGroup blocks={blocks} isStreaming={isStreaming} />))
  }

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

  it('shows live reasoning and collapses after completion', async () => {
    const blocks = [
      thinkingBlock({
        content: 'Inspecting the workflow.\nPreparing the update.',
      }),
    ]

    await renderGroup(blocks, true)

    expect(container.textContent).toContain('Thinking...')
    expect(container.textContent).toContain('Inspecting the workflow.')
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')

    await renderGroup(blocks)

    expect(container.textContent).toContain('Finished thinking')
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('renders expanded thinking content as markdown', async () => {
    const blocks = [
      thinkingBlock({
        content: 'Inspecting **workflow**.\n\n- Validate edges',
      }),
    ]

    await renderGroup(blocks, true)

    expect(container.querySelector('strong')?.textContent).toBe('workflow')
    expect(container.querySelector('ul')?.textContent).toContain('Validate edges')
  })
})
