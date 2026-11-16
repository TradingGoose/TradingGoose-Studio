/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SidebarDropdownMenuContent } from './sidebar-dropdown-menu'
import { TooltipProvider } from './tooltip'

const Icon = (props: { className?: string }) => <svg {...props} />
const onActiveGroupChange = vi.fn()
const onSelectItem = vi.fn()
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
})

function render(props: Partial<ComponentProps<typeof SidebarDropdownMenuContent>>) {
  act(() =>
    root.render(
      <TooltipProvider>
        <SidebarDropdownMenuContent
          groups={[]}
          items={[]}
          onActiveGroupChange={onActiveGroupChange}
          onSelectItem={onSelectItem}
          emptyContent='No models'
          {...props}
        />
      </TooltipProvider>
    )
  )
}

it('renders mixed provider groups consistently as labeled rows and preserves selection', () => {
  const groups = [
    { id: 'custom', label: 'Custom provider with a long name' },
    { id: 'deepseek', label: 'DeepSeek', icon: Icon },
  ]
  const item = { id: 'deepseek/model', groupId: 'deepseek', label: 'Exact model', selected: true }
  render({ groups, items: [item] })

  for (const group of groups) {
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${group.label}"]`)!
    expect(button).toHaveTextContent(group.label)
    expect(button).toHaveAttribute('title', group.label)
    expect(button.querySelector('svg')).toBeNull()
  }
  const provider = container.querySelector<HTMLButtonElement>('[aria-label="DeepSeek"]')!
  act(() => provider.click())
  expect(onActiveGroupChange).toHaveBeenCalledExactlyOnceWith('deepseek')
  render({ groups, items: [item], activeGroupId: 'deepseek' })
  expect(container.querySelector('[aria-label="DeepSeek"]')).toHaveAttribute('data-active', 'true')
  act(() => container.querySelector<HTMLButtonElement>('[data-option-index="0"]')!.click())
  expect(onSelectItem).toHaveBeenCalledExactlyOnceWith(item, expect.anything())
})

it('keeps a large text sidebar scrollable without compressing its rows', () => {
  const groups = Array.from({ length: 221 }, (_, index) => ({
    id: `provider-${index}`,
    label: `Provider ${index}`,
  }))
  render({ groups })
  const buttons = container.querySelectorAll<HTMLButtonElement>('button')
  expect(buttons).toHaveLength(groups.length)
  for (const button of buttons) {
    expect(button).toHaveClass('h-8', 'shrink-0', 'w-full')
    expect(button).toHaveTextContent(button.getAttribute('aria-label')!)
  }
  expect(buttons[0].parentElement).toHaveClass('h-56', 'overflow-y-auto')
})

it('preserves the compact icon sidebar for groups that all have icons', () => {
  render({ groups: [{ id: 'default', label: 'Default indicators', icon: Icon }] })
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Default indicators"]')!
  expect(button).toHaveClass('h-8', 'shrink-0', 'w-8')
  expect(button.querySelector('svg')).not.toBeNull()
  expect(button.textContent).toBe('')
  expect(button).not.toHaveAttribute('title')
  expect(button.parentElement?.parentElement).toHaveClass('w-12')
})

it('retains loading and empty content with text-only groups', () => {
  const groups = [{ id: 'all', label: 'All' }]
  render({ groups, loadingContent: 'Searching listings' })
  expect(container).toHaveTextContent('Searching listings')
  expect(container).not.toHaveTextContent('No models')
  render({ groups })
  expect(container).toHaveTextContent('No models')
  expect(container.querySelector('[aria-label="All"]')).toHaveTextContent('All')
})
