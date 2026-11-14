/** @vitest-environment jsdom */

import { act, Children, cloneElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    accessLevel: {
      full: { label: 'Full', description: 'Full access' },
      limited: { label: 'Limited', description: 'Limited access' },
    },
    models: {
      loading: 'Loading models',
      unconfigured: 'No models configured',
      loadError: 'Unavailable',
      providerOptions: 'Provider Options',
      apply: 'Apply',
      invalidOptions: 'Enter valid provider options JSON.',
    },
  }),
}))
vi.mock('@/components/ui', () => ({
  Button: ({ variant: _variant, size: _size, ...props }: any) => <button {...props} />,
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ render, children, ...props }: any) =>
    cloneElement(render, props, children),
  DropdownMenuContent: ({ align: _align, side: _side, ...props }: any) => <div {...props} />,
  DropdownMenuItem: (props: any) => <button {...props} />,
  TooltipProvider: ({ children }: any) => children,
  Tooltip: ({ children }: any) => children,
  TooltipTrigger: ({ render }: any) => render,
  TooltipContent: () => null,
  Popover: ({ children, open, onOpenChange }: any) => (
    <div>
      {Children.map(children, (child) =>
        cloneElement(child, { popoverOpen: open, onPopoverOpenChange: onOpenChange })
      )}
    </div>
  ),
  PopoverTrigger: ({ render, children, onPopoverOpenChange, disabled }: any) =>
    cloneElement(render, { disabled, onClick: () => onPopoverOpenChange(true) }, children),
  PopoverContent: ({
    popoverOpen,
    onPopoverOpenChange: _change,
    align: _align,
    side: _side,
    ...props
  }: any) => (popoverOpen ? <div {...props} /> : null),
  Textarea: (props: any) => <textarea {...props} />,
}))

import { AccessLevelSelector } from './access-level-selector'
import { ModelSelector } from './model-selector'

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
const render = () =>
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ModelSelector isNearTop={false} panelWidth={400} />
        <AccessLevelSelector isNearTop={false} />
      </QueryClientProvider>
    )
  )

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient()
  queryClient.setQueryData(['provider-icons'], {
    anthropic: {
      src: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/anthropic.svg',
      monochrome: true,
    },
  })
  state = {
    accessLevel: 'full',
    setAccessLevel: vi.fn(),
    selectedModel: null,
    setSelectedModel: vi.fn(),
    providerOptions: undefined,
    setProviderOptions: vi.fn(),
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
  queryClient.clear()
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
  catalog = { ...catalog, data: { models: [] }, isError: false }
  render()
  expect(container.textContent).toContain('No models configured')
  expect(state.setSelectedModel).not.toHaveBeenCalled()
})

it('initially selects the first configured model and submits exact IDs while displaying only labels', () => {
  catalog.data = {
    models: [
      { id: 'openrouter/anthropic/model-name', label: 'anthropic/model-name' },
      { id: 'openai/future-model', label: 'openai/future-model' },
    ],
  }
  render()
  expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('openrouter/anthropic/model-name')
  state.selectedModel = catalog.data.models[0].id
  render()
  const trigger = container.querySelector('button')!
  expect(trigger).toHaveTextContent('anthropic/model-name')
  expect(trigger).toHaveAttribute('aria-label', 'anthropic/model-name')
  expect(trigger).toHaveAttribute('title', 'anthropic/model-name')
  expect(trigger.querySelector('img')).toHaveAttribute(
    'src',
    'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/anthropic.svg'
  )
  expect(container.innerHTML).not.toContain('openrouter')
  act(() => trigger.querySelector('img')!.dispatchEvent(new Event('error')))
  render()
  expect(trigger.querySelector('img')).toHaveAttribute(
    'src',
    'https://models.dev/logos/anthropic.svg'
  )
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
  }
  state.selectedModel = catalog.data.models[0].id
  render()
  const choices = [...container.querySelectorAll<HTMLButtonElement>('button[title]')].slice(1)
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

it('edits native provider options, rejects invalid settings, and clears options with blank input', () => {
  state.selectedModel = 'anthropic/selected-model'
  state.providerOptions = { anthropic: { effort: 'low' } }
  catalog.data = { models: [{ id: state.selectedModel, label: state.selectedModel }] }
  render()
  const open = () =>
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Provider Options"]')!.click()
    )
  const edit = (value: string) =>
    act(() => {
      const textarea = container.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        textarea,
        value
      )
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const apply = () =>
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Apply')!
        .click()
    )
  open()
  expect(container.querySelector('textarea')).toHaveValue(
    JSON.stringify(state.providerOptions, null, 2)
  )
  for (const invalid of ['{', '{"anthropic":{"apiKey":"forbidden"}}']) {
    edit(invalid)
    apply()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(state.setProviderOptions).not.toHaveBeenCalled()
  }
  edit('{"anthropic":{"effort":"high"}}')
  apply()
  expect(state.setProviderOptions).toHaveBeenLastCalledWith({ anthropic: { effort: 'high' } })
  expect(container.querySelector('textarea')).toBeNull()
  open()
  edit('')
  apply()
  expect(state.setProviderOptions).toHaveBeenLastCalledWith(undefined)
})

it('preserves a valid selection and replaces a removed selection on catalog refresh', () => {
  state.selectedModel = 'openai/selected-model'
  catalog.data = {
    models: [
      { id: 'anthropic/first-model', label: 'anthropic/first-model' },
      { id: state.selectedModel, label: 'openai/selected-model' },
    ],
  }
  render()
  expect(state.setSelectedModel).not.toHaveBeenCalled()
  catalog.data = {
    models: [{ id: 'deepseek/new-model', label: 'deepseek/new-model' }],
  }
  render()
  expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('deepseek/new-model')
  catalog.data = { models: [] }
  render()
  expect(state.setSelectedModel).toHaveBeenLastCalledWith(null)
})

it.each(['isSendingMessage', 'isAwaitingContinuation', 'isAborting', 'pending-tool'])(
  'locks access, model and open provider options and hides a removed route during %s',
  (busyState) => {
    state.selectedModel = 'openrouter/anthropic/original-model'
    catalog.data = { models: [{ id: state.selectedModel, label: 'anthropic/original-model' }] }
    render()
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Provider Options"]')!.click()
    )
    if (busyState === 'pending-tool') state.toolCallsById = { pending: { state: 'pending' } }
    else state[busyState] = true
    render()
    expect(container.querySelector('textarea')).toBeDisabled()
    for (const button of container.querySelectorAll('button')) {
      expect(button).toBeDisabled()
      act(() => button.click())
    }
    expect(state.setProviderOptions).not.toHaveBeenCalled()
    expect(state.setAccessLevel).not.toHaveBeenCalled()
    catalog.data = { models: [{ id: 'openai/replacement', label: 'openai/replacement' }] }
    catalog.isPending = false
    render()
    expect(container.querySelector('button')).toHaveTextContent('Unavailable')
    expect(container.innerHTML).not.toContain('openrouter')
    expect(state.setSelectedModel).not.toHaveBeenCalled()
    state.toolCallsById = {}
    if (busyState !== 'pending-tool') state[busyState] = false
    render()
    expect(state.setSelectedModel).toHaveBeenCalledExactlyOnceWith('openai/replacement')
    const limited = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Limited'
    )!
    expect(limited).toBeEnabled()
    act(() => limited.click())
    expect(state.setAccessLevel).toHaveBeenCalledExactlyOnceWith('limited')
  }
)
