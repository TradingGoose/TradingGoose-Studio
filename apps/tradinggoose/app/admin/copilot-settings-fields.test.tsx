/** @vitest-environment jsdom */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CopilotSettings } from '@/lib/copilot/settings'
import { CopilotSettingsFields } from './copilot-settings-fields'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

let root: Root
let container: HTMLDivElement
let settings: CopilotSettings
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function Harness({ initial }: { initial: CopilotSettings }) {
  const [value, setValue] = useState(initial)
  settings = value
  return <CopilotSettingsFields value={value} onChange={setValue} />
}

async function render(initial: CopilotSettings) {
  await act(async () => root.render(<Harness initial={initial} />))
}

async function changeModel(index: number, model: string) {
  const input = container.querySelector<HTMLInputElement>(`#copilot-model-${index}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, model)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === label || candidate.getAttribute('aria-label') === label
  )!
  await act(async () => button.click())
}

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  environment.IS_REACT_ACT_ENVIRONMENT = false
})

it('adds an exact new model ID without requiring registry or pricing metadata', async () => {
  await render({ models: [], defaultModel: null })
  expect(container.textContent).toContain('No models configured')
  expect(container.querySelector('a')).toHaveAttribute('href', '/admin/services')
  await click('Add model')
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  await changeModel(0, 'brand-new-model-2027')
  expect(settings).toEqual({
    models: [{ provider: 'openai', model: 'brand-new-model-2027' }],
    defaultModel: 'openai/brand-new-model-2027',
  })
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it('keeps the selected default when editing another row and follows edits to its own row', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'anthropic', model: 'second' },
    ],
    defaultModel: 'anthropic/second',
  })
  await changeModel(0, 'first-updated')
  expect(settings.defaultModel).toBe('anthropic/second')
  await changeModel(1, 'second-updated')
  expect(settings.defaultModel).toBe('anthropic/second-updated')
  await act(async () => container.querySelector<HTMLButtonElement>('#copilot-default-0')!.click())
  expect(settings.defaultModel).toBe('openai/first-updated')
})

it('moves the default when its row is removed and clears it when the list becomes empty', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'deepseek', model: 'second' },
    ],
    defaultModel: 'openai/first',
  })
  await click('Remove model row 1')
  expect(settings.defaultModel).toBe('deepseek/second')
  await click('Remove model row 1')
  expect(settings).toEqual({ models: [], defaultModel: null })
})

it('shows duplicate-pair validation without replacing exact entered IDs', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'openai', model: 'second' },
    ],
    defaultModel: 'openai/first',
  })
  await changeModel(1, 'first')
  expect(container.querySelector('[role="alert"]')).toHaveTextContent('duplicate provider/model')
  expect(settings.models[1].model).toBe('first')
})

it('accepts pasted outer whitespace while keeping the default model identity canonical', async () => {
  await render({
    models: [{ provider: 'openai', model: 'first' }],
    defaultModel: 'openai/first',
  })
  await changeModel(0, ' future-model ')
  expect(settings.models[0].model).toBe(' future-model ')
  expect(settings.defaultModel).toBe('openai/future-model')
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

it('updates the default identity when its provider changes', async () => {
  await render({
    models: [{ provider: 'openai', model: 'exact-future-model' }],
    defaultModel: 'openai/exact-future-model',
  })
  await act(async () => container.querySelector<HTMLButtonElement>('#copilot-provider-0')!.click())
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.textContent === 'DeepSeek'
  )!
  await act(async () => {
    option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    option.click()
  })
  expect(settings).toEqual({
    models: [{ provider: 'deepseek', model: 'exact-future-model' }],
    defaultModel: 'deepseek/exact-future-model',
  })
})

it('leaves text-input arrow keys to the editor without changing the default radio', async () => {
  await render({
    models: [
      { provider: 'openai', model: 'first' },
      { provider: 'anthropic', model: 'second' },
    ],
    defaultModel: 'anthropic/second',
  })
  const input = container.querySelector<HTMLInputElement>('#copilot-model-0')!
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    await act(async () => {
      input.focus()
      input.setSelectionRange(2, 2)
      input.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
    expect(settings.defaultModel).toBe('anthropic/second')
  }
})
