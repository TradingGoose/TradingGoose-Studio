/** @vitest-environment jsdom */

import { act, cloneElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let state: any
let catalog: any
const { getModelIcon } = vi.hoisted(() => ({ getModelIcon: vi.fn() }))

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
vi.mock('@/lib/ui/model-icon', () => ({ getModelIcon }))
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
  getModelIcon
    .mockReset()
    .mockImplementation((label: string) => (props: any) => (
      <svg data-model-icon={label} {...props} />
    ))
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

it('uses the administrator default and submits exact IDs while displaying only labels', () => {
  catalog.data = {
    models: [
      { id: 'openai/future-model', label: 'openai/future-model' },
      { id: 'openrouter/anthropic/model-name', label: 'anthropic/model-name' },
    ],
    defaultModel: 'openrouter/anthropic/model-name',
  }
  render()
  expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('openrouter/anthropic/model-name')
  state.selectedModel = catalog.data.defaultModel
  render()
  const trigger = container.querySelector('button')!
  expect(trigger).toHaveTextContent('anthropic/model-name')
  expect(trigger).toHaveAttribute('aria-label', 'anthropic/model-name')
  expect(trigger).toHaveAttribute('title', 'anthropic/model-name')
  expect(trigger.querySelector('svg')).toHaveAttribute('data-model-icon', 'anthropic/model-name')
  expect(container.innerHTML).not.toContain('openrouter')
  expect(getModelIcon).toHaveBeenCalledWith('anthropic/model-name')
  expect(getModelIcon).not.toHaveBeenCalledWith('openrouter/anthropic/model-name')
  const choice = container.querySelector<HTMLButtonElement>('[title="openai/future-model"]')!
  act(() => choice.click())
  expect(state.setSelectedModel).toHaveBeenLastCalledWith('openai/future-model')
})

it('keeps distinct gateway routes selectable when they share a display label', () => {
  catalog.data = {
    models: [
      { id: 'openrouter/anthropic/model', label: 'anthropic/model' },
      { id: 'vercel/anthropic/model', label: 'anthropic/model' },
    ],
    defaultModel: 'openrouter/anthropic/model',
  }
  state.selectedModel = catalog.data.defaultModel
  render()
  const choices = [...container.querySelectorAll<HTMLButtonElement>('button')].slice(1)
  expect(choices).toHaveLength(2)
  for (const [index, choice] of choices.entries()) {
    expect(choice).toHaveTextContent('anthropic/model')
    expect(choice).toHaveAttribute('aria-label', 'anthropic/model')
    expect(choice).toHaveAttribute('title', 'anthropic/model')
    act(() => choice.click())
    expect(state.setSelectedModel).toHaveBeenLastCalledWith(catalog.data.models[index].id)
  }
  expect(container.innerHTML).not.toMatch(/openrouter|vercel/)
})

it('preserves a valid selection and replaces a removed selection on catalog refresh', () => {
  state.selectedModel = 'openai/selected-model'
  catalog.data = {
    models: [{ id: state.selectedModel, label: 'openai/selected-model' }],
    defaultModel: state.selectedModel,
  }
  render()
  expect(state.setSelectedModel).not.toHaveBeenCalled()
  catalog.data = {
    models: [{ id: 'deepseek/new-model', label: 'deepseek/new-model' }],
    defaultModel: 'deepseek/new-model',
  }
  render()
  expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('deepseek/new-model')
  catalog.data = { models: [], defaultModel: null }
  render()
  expect(state.setSelectedModel).toHaveBeenLastCalledWith(null)
})

it.each(['isSendingMessage', 'isAwaitingContinuation', 'isAborting', 'pending-tool'])(
  'preserves the active selection and hides a removed route during %s',
  (busyState) => {
    state.selectedModel = 'openrouter/anthropic/original-model'
    if (busyState === 'pending-tool') state.toolCallsById = { pending: { state: 'pending' } }
    else state[busyState] = true
    catalog.data = {
      models: [{ id: 'openai/replacement', label: 'openai/replacement' }],
      defaultModel: 'openai/replacement',
    }
    catalog.isPending = false
    render()
    expect(state.setSelectedModel).not.toHaveBeenCalled()
    expect(container.querySelector('button')).toBeDisabled()
    expect(container.querySelector('button')).toHaveTextContent('Unavailable')
    expect(container.innerHTML).not.toContain('openrouter')
    for (const button of container.querySelectorAll('button')) {
      expect(button).toBeDisabled()
      act(() => button.click())
    }
    expect(state.setSelectedModel).not.toHaveBeenCalled()
    state.toolCallsById = {}
    if (busyState !== 'pending-tool') state[busyState] = false
    render()
    expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('openai/replacement')
  }
)
