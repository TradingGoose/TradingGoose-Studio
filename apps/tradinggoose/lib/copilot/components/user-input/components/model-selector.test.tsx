/** @vitest-environment jsdom */

import { act, cloneElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let state: any
let catalog: any

vi.mock('@/hooks/queries/copilot-models', () => ({ useCopilotModels: () => catalog }))
vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: (selector: (value: any) => any) => selector(state),
}))
vi.mock('@/i18n/workspace-widget-hooks', () => ({
  useCopilotMessages: () => ({
    models: {
      loading: 'Loading models',
      unconfigured: 'No models configured',
      loadError: 'Unavailable',
    },
  }),
}))
vi.mock('@/lib/ui/model-icon', () => ({ getModelIcon: () => null }))
vi.mock('@/components/ui', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: any) => <button {...props} />,
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ render, children }: any) => cloneElement(render, {}, children),
  DropdownMenuContent: ({ align: _align, side: _side, ...props }: any) => <div {...props} />,
  DropdownMenuItem: (props: any) => <button {...props} />,
}))

import { ModelSelector } from './model-selector'

let container: HTMLDivElement
let root: Root
const render = () => act(() => root.render(<ModelSelector isNearTop={false} panelWidth={400} />))

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  state = {
    selectedModel: null,
    setSelectedModel: vi.fn(),
    isSendingMessage: false,
    isAwaitingContinuation: false,
    isAborting: false,
    toolCallsById: {},
  }
  catalog = { data: undefined, isPending: true, isError: false, refetch: vi.fn() }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
})

it('shows loading, unavailable, and unconfigured states without choosing a fixed model', () => {
  render()
  expect(container.textContent).toContain('Loading models')
  expect(container.querySelector('button')?.disabled).toBe(true)
  catalog = { ...catalog, isPending: false, isError: true }
  render()
  expect(container.textContent).toContain('Unavailable')
  catalog = { ...catalog, data: { models: [], defaultModel: null }, isError: false }
  render()
  expect(container.textContent).toContain('No models configured')
  expect(state.setSelectedModel).not.toHaveBeenCalled()
})

it('uses the administrator default and offers exact IDs outside the old catalog', () => {
  catalog.data = {
    models: ['openai/future-model', 'openrouter/vendor/model-name'],
    defaultModel: 'openrouter/vendor/model-name',
  }
  render()
  expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('openrouter/vendor/model-name')
  const choice = container.querySelector<HTMLButtonElement>('[title="openai/future-model"]')!
  act(() => choice.click())
  expect(state.setSelectedModel).toHaveBeenLastCalledWith('openai/future-model')
})

it('preserves a valid selection and replaces a removed selection on catalog refresh', () => {
  state.selectedModel = 'openai/selected-model'
  catalog.data = { models: [state.selectedModel], defaultModel: state.selectedModel }
  render()
  expect(state.setSelectedModel).not.toHaveBeenCalled()
  catalog.data = { models: ['deepseek/new-model'], defaultModel: 'deepseek/new-model' }
  render()
  expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('deepseek/new-model')
  catalog.data = { models: [], defaultModel: null }
  render()
  expect(state.setSelectedModel).toHaveBeenLastCalledWith(null)
})

it('does not change a model selection while its turn is active', () => {
  state.selectedModel = 'openai/original-model'
  state.isAwaitingContinuation = true
  catalog.data = { models: ['openai/replacement'], defaultModel: 'openai/replacement' }
  render()
  expect(state.setSelectedModel).not.toHaveBeenCalled()
  expect(container.querySelector('button')?.disabled).toBe(true)
  state.isAwaitingContinuation = false
  render()
  expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('openai/replacement')
})
