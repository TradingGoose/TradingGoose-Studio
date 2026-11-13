/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { CopilotSettings } from '@/lib/copilot/settings'
import { useModelRegistry } from '@/stores/model-registry'
import { CopilotSettingsFields } from './copilot-settings-fields'

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let settings: CopilotSettings
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalRegistry = useModelRegistry.getState()
const loadRegistry = vi.fn(async () => {})
const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

function Harness({ initial }: { initial: CopilotSettings }) {
  const [value, setValue] = useState(initial)
  settings = value
  return <CopilotSettingsFields value={value} onChange={setValue} />
}

async function render(initial: CopilotSettings) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Harness initial={initial} />
        </TooltipProvider>
      </QueryClientProvider>
    )
  )
}

const searchInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Model"]')!
const candidate = (id: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button[data-option-index]')].find(
    (button) => button.textContent?.trim() === id
  )!
async function openPicker(index: number) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`#copilot-model-${index}`)!.click()
  )
  expect(searchInput()).not.toBeNull()
}
async function search(value: string) {
  await act(async () => {
    const input = searchInput()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function key(key: string) {
  await act(async () =>
    searchInput().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    )
  )
}
async function choose(index: number, id: string) {
  await openPicker(index)
  await search(id)
  expect(candidate(id)).toBeDefined()
  await act(async () => candidate(id).click())
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label
  )!
  await act(async () => button.click())
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  loadRegistry.mockClear()
  useModelRegistry.setState({
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'openai/first' }, { id: 'openai/second' }, { id: 'openai/listed-model' }],
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: [{ id: 'anthropic/first' }, { id: 'anthropic/second' }],
      },
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek/deepseek-chat' }] },
    ],
    isLoading: false,
    error: undefined,
    load: loadRegistry,
  })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['provider-icons'], {})
  environment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  container.remove()
  environment.IS_REACT_ACT_ENVIRONMENT = false
  useModelRegistry.setState(originalRegistry)
  if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView)
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

it('adds an exact future model through the searchable picker without registry or pricing membership', async () => {
  await render({ models: [] })
  expect(container.textContent).toContain('No models configured')
  await click('Add model')
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  await openPicker(0)
  expect(searchInput()).toHaveAttribute('placeholder', 'Search models or enter provider/model')
  await search('openai/brand-new-model-2027')
  await key('Enter')
  expect(settings).toEqual({
    models: [{ provider: 'openai', model: 'brand-new-model-2027' }],
  })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.querySelector('#copilot-model-0')).toHaveAttribute('aria-expanded', 'false')
  expect(loadRegistry).toHaveBeenCalledOnce()
})

it('uses native provider sidebar choices and searches provider names with full model IDs', async () => {
  await render({ models: [{ provider: 'openai', model: 'first' }] })
  await openPicker(0)
  expect(container.querySelector('datalist')).toBeNull()
  expect(container.querySelector('#copilot-provider-0')).toBeNull()
  await click('DeepSeek')
  expect(candidate('deepseek/deepseek-chat')).toBeDefined()
  await search('Anthropic')
  expect(candidate('anthropic/first')).toBeDefined()
  expect(candidate('openai/first')).toBeUndefined()
  await act(async () => candidate('anthropic/first').click())
  expect(settings).toEqual({
    models: [{ provider: 'anthropic', model: 'first' }],
  })
})

it('preserves namespaced provider and model IDs using the longest known provider prefix', async () => {
  useModelRegistry.setState({
    providers: [
      { id: 'private', name: 'Private', models: [{ id: 'private/other' }] },
      {
        id: 'private/inference',
        name: 'Private inference',
        models: [{ id: 'private/inference/accounts/team/models/exact-model' }],
      },
    ],
  })
  await render({ models: [] })
  await click('Add model')
  await choose(0, 'private/inference/accounts/team/models/exact-model')
  expect(settings.models[0]).toEqual({
    provider: 'private/inference',
    model: 'accounts/team/models/exact-model',
  })
  await choose(0, 'private/inference/accounts/team/models/new-model')
  expect(settings).toEqual({
    models: [{ provider: 'private/inference', model: 'accounts/team/models/new-model' }],
  })
})

it('commits the exact qualified native ID ahead of a longer matching gateway model', async () => {
  useModelRegistry.setState({
    providers: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: [{ id: 'openrouter/anthropic/future-model-preview' }],
      },
      { id: 'anthropic', name: 'Anthropic', models: [{ id: 'anthropic/listed' }] },
    ],
  })
  await render({
    models: [{ provider: 'openrouter', model: 'anthropic/future-model-preview' }],
  })
  await openPicker(0)
  await search('anthropic/future-model')
  expect(document.querySelector('button[aria-label="Anthropic"]')).toHaveAttribute(
    'data-active',
    'true'
  )
  expect(candidate('anthropic/future-model')).toBeDefined()
  expect(candidate('openrouter/anthropic/future-model-preview')).toBeUndefined()
  await key('Enter')
  expect(settings).toEqual({
    models: [{ provider: 'anthropic', model: 'future-model' }],
  })
})

it('commits the exact listed ID when a longer model appears first in the same provider', async () => {
  useModelRegistry.setState({
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'openai/future-model-preview' }, { id: 'openai/future-model' }],
      },
    ],
  })
  await render({
    models: [{ provider: 'openai', model: 'future-model-preview' }],
  })
  await openPicker(0)
  await search('openai/future-model')
  await key('Enter')
  expect(settings).toEqual({
    models: [{ provider: 'openai', model: 'future-model' }],
  })
})

it('shows loading and retry states without offering fixed providers', async () => {
  useModelRegistry.setState({ providers: [], isLoading: true })
  await render({ models: [] })
  expect(container.querySelector('[role="status"]')).toHaveTextContent('Loading models')
  expect(container.querySelector('button')).toBeDisabled()
  await act(async () => useModelRegistry.setState({ isLoading: false, error: 'Unavailable' }))
  expect(container.querySelector('[role="alert"]')).toHaveTextContent(
    'Model registry is unavailable'
  )
  await click('Try again')
  expect(loadRegistry).toHaveBeenCalledTimes(2)
  expect(settings.models).toEqual([])
})

it('keeps an unlisted saved choice visible and leaves settings unchanged on registry failure', async () => {
  const original = {
    models: [{ provider: 'openai', model: 'future-model' }],
  }
  await render(original)
  await openPicker(0)
  expect(candidate('openai/future-model')).toBeDefined()
  await key('Escape')
  await act(async () => useModelRegistry.setState({ providers: [], error: 'Unavailable' }))
  expect(container.querySelector('#copilot-model-0')).toHaveTextContent('openai/future-model')
  expect(settings).toEqual(original)
  await click('Try again')
  expect(settings).toEqual(original)
})

it('edits rows independently while preserving their order', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'anthropic', model: 'second' },
    ],
  })
  await choose(0, 'openai/listed-model')
  expect(settings.models[1]).toEqual({ provider: 'anthropic', model: 'second' })
  await choose(1, 'deepseek/deepseek-chat')
  expect(settings).toEqual({
    models: [
      { provider: 'openai', model: 'listed-model' },
      { provider: 'deepseek', model: 'deepseek-chat' },
    ],
  })
})

it('preserves the remaining order when removing rows and allows an empty list', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'deepseek', model: 'deepseek-chat' },
    ],
  })
  await click('Remove model row 1')
  expect(settings).toEqual({ models: [{ provider: 'deepseek', model: 'deepseek-chat' }] })
  await click('Remove model row 1')
  expect(settings).toEqual({ models: [] })
})

it('validates duplicate exact pairs while allowing the same model name under different providers', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'anthropic', model: 'first' },
    ],
  })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  await choose(1, 'openai/first')
  expect(container.querySelector('[role="alert"]')).toHaveTextContent('duplicate provider/model')
  expect(settings.models[1]).toEqual({ provider: 'openai', model: 'first' })
})

it('canonicalizes pasted outer whitespace when committing an exact custom model', async () => {
  await render({ models: [{ provider: 'openai', model: 'first' }] })
  await openPicker(0)
  await search(' openai/future-model ')
  await key('Enter')
  expect(settings).toEqual({
    models: [{ provider: 'openai', model: 'future-model' }],
  })
})

it('navigates native options with arrows and commits only the edited row on Enter', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'anthropic', model: 'second' },
    ],
  })
  await openPicker(0)
  await key('ArrowDown')
  await key('ArrowDown')
  expect(settings.models[0]).toEqual({ provider: 'openai', model: 'first' })
  await key('Enter')
  expect(settings.models[0]).toEqual({ provider: 'openai', model: 'second' })
  expect(settings.models[1]).toEqual({ provider: 'anthropic', model: 'second' })
})

it('cancels search and preserves text-editing keys without changing saved choices', async () => {
  const original = {
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'anthropic', model: 'second' },
    ],
  }
  await render(original)
  await openPicker(0)
  await search('openai/uncommitted-model')
  for (const value of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) await key(value)
  expect(settings).toEqual(original)
  await key('Escape')
  expect(container.querySelector('#copilot-model-0')).toHaveAttribute('aria-expanded', 'false')
  expect(settings).toEqual(original)
})
