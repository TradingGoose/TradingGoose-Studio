/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type LayoutTab, LayoutTabs } from './layout-tabs'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const layouts: LayoutTab[] = [
  {
    id: 'layout-1',
    name: 'Layout 1',
    sortOrder: 0,
    isActive: true,
  },
]

describe('LayoutTabs', () => {
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

  const renderTabs = async (props: Partial<Parameters<typeof LayoutTabs>[0]> = {}) => {
    await act(async () => {
      root.render(
        <LayoutTabs
          layouts={layouts}
          onSelect={vi.fn()}
          onReorder={vi.fn()}
          onCreate={vi.fn()}
          {...props}
        />
      )
    })
  }

  it('keeps inline rename when only onRename is supplied', async () => {
    const onRename = vi.fn()
    await renderTabs({ onRename })

    const renameButton = container.querySelector('button[aria-label="Rename Layout 1"]')
    if (!(renameButton instanceof HTMLButtonElement)) {
      throw new Error('Expected rename button to render')
    }

    await act(async () => {
      renameButton.click()
    })

    const input = container.querySelector('input')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Expected inline rename input to render')
    }

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'Renamed Layout')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onRename).toHaveBeenCalledWith('layout-1', 'Renamed Layout')
  })

  it('uses external rename without rendering the inline input', async () => {
    const onRequestRename = vi.fn()
    await renderTabs({ onRequestRename })

    const renameButton = container.querySelector('button[aria-label="Rename Layout 1"]')
    if (!(renameButton instanceof HTMLButtonElement)) {
      throw new Error('Expected rename button to render')
    }

    await act(async () => {
      renameButton.click()
    })

    expect(onRequestRename).toHaveBeenCalledWith('layout-1')
    expect(container.querySelector('input')).toBeNull()
  })

  it('hides the rename action when no rename handler is supplied', async () => {
    await renderTabs()

    expect(container.querySelector('button[aria-label="Rename Layout 1"]')).toBeNull()
  })
})
