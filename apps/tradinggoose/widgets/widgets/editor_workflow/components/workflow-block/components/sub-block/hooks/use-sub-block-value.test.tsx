/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useModelRegistry } from '@/stores/model-registry'
import { useSubBlockValue } from './use-sub-block-value'

const originalProviders = useModelRegistry.getState().providers

const mocks = vi.hoisted(() => ({
  values: { model: '', apiKey: 'saved-key' } as Record<string, string>,
  write: vi.fn(),
}))
vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useBlock: () => ({ type: 'agent' }),
  useSubBlockValue: (_blockId: string, field: string) => mocks.values[field],
}))
vi.mock('@/hooks/workflow/use-workflow-editor-actions', () => ({
  useWorkflowEditorActions: () => ({ collaborativeSetSubblockValue: mocks.write }),
}))

let root: Root
let setModel: (model: string) => void
let activeBlockId: string
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
function Harness() {
  ;[, setModel] = useSubBlockValue<string>(activeBlockId, 'model')
  return null
}
function render(model: string, blockId = 'agent') {
  activeBlockId = blockId
  mocks.values.model = model
  act(() => root.render(<Harness />))
}
function type(model: string) {
  act(() => {
    setModel(model)
    root.render(<Harness />)
  })
}
beforeEach(() => {
  useModelRegistry.setState({
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'openai/gpt-4.1' }, { id: 'openai/gpt-5.6-sol' }],
      },
      { id: 'anthropic', name: 'Anthropic', models: [{ id: 'anthropic/claude-sonnet-5-5' }] },
    ],
  })
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  activeBlockId = 'agent'
  mocks.values = { model: '', apiKey: 'saved-key' }
  mocks.write.mockReset().mockImplementation((_blockId, field, value) => {
    mocks.values[field] = value
  })
  root = createRoot(document.createElement('div'))
})
afterEach(() => {
  act(() => root.unmount())
  useModelRegistry.setState({ providers: originalProviders })
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

it('persists partial names and clears the key only when the next provider is recognized', () => {
  render('openai/gpt-4.1')
  for (const value of ['c', 'cl', 'claud']) {
    expect(() => type(value)).not.toThrow()
    expect(mocks.values.apiKey).toBe('saved-key')
  }
  type('anthropic/claude-sonnet-5-5')
  expect(mocks.values).toEqual({ model: 'anthropic/claude-sonnet-5-5', apiKey: '' })
  expect(mocks.write.mock.calls.filter((call) => call[1] === 'apiKey')).toEqual([
    ['agent', 'apiKey', ''],
  ])
})

it('retains the key through empty drafts and a model change within the same provider', () => {
  render('openai/gpt-4.1')
  for (const value of ['', 'g', 'openai/gpt-5.6-sol']) type(value)
  expect(mocks.values.apiKey).toBe('saved-key')
})

it.each(['c', '', '<start.model>', 'unsupported-model'])(
  'clears an unowned key when resolving the saved model %s',
  (model) => {
    expect(() => render(model)).not.toThrow()
    expect(() => type('cl')).not.toThrow()
    expect(mocks.values.apiKey).toBe('saved-key')
    type('anthropic/claude-sonnet-5-5')
    expect(mocks.values.apiKey).toBe('')
  }
)

it.each([
  ['c', 'anthropic/claude-sonnet-5-5', ''],
  ['openai/gpt-4.1', 'openai/gpt-5.6-sol', 'saved-key'],
])('reopens %s without retaining another provider’s ownership', (model, selection, expectedKey) => {
  render('openai/gpt-4.1')
  type(model)
  act(() => root.render(null))
  render(model)
  type(selection)
  expect(mocks.values.apiKey).toBe(expectedKey)
})

it.each(['c', 'openai/gpt-4.1'])(
  'uses only the selected block provider after switching to %s',
  (model) => {
    render('openai/gpt-4.1')
    render(model, 'other-agent')
    type('anthropic/claude-sonnet-5-5')
    expect(mocks.values.apiKey).toBe('')
    expect(mocks.write.mock.calls.every((call) => call[0] === 'other-agent')).toBe(true)
  }
)

it('recognizes saved model key ownership when registry arrives after mount', () => {
  const loaded = useModelRegistry.getState().providers
  useModelRegistry.setState({ providers: [] })
  render('openai/gpt-4.1')
  act(() => useModelRegistry.setState({ providers: loaded }))
  type('openai/gpt-5.6-sol')
  expect(mocks.values.apiKey).toBe('saved-key')
})

it.each(['anthropic/claude-sonnet-5-5', 'openai/gpt-5.6-sol', '<upstream.model>'])(
  'clears the existing credential immediately when changing to %s before registry loads',
  (model) => {
    const loaded = useModelRegistry.getState().providers
    useModelRegistry.setState({ providers: [] })
    render('openai/gpt-4.1')
    type(model)
    expect(mocks.values).toEqual({ model, apiKey: '' })
    expect(mocks.write.mock.calls.filter((call) => call[1] === 'apiKey')).toEqual([
      ['agent', 'apiKey', ''],
    ])

    act(() => useModelRegistry.setState({ providers: loaded }))
    type('anthropic/claude-sonnet-5-5')
    expect(mocks.values.apiKey).toBe('')
    expect(mocks.write.mock.calls.filter((call) => call[1] === 'apiKey')).toHaveLength(1)
  }
)
