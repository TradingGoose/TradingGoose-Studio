/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSubBlockValue } from './use-sub-block-value'

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
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

it('persists partial names and clears the key only when the next provider is recognized', () => {
  render('gpt-4.1')
  for (const value of ['c', 'cl', 'claud']) {
    expect(() => type(value)).not.toThrow()
    expect(mocks.values.apiKey).toBe('saved-key')
  }
  type('claude-sonnet-5')
  expect(mocks.values).toEqual({ model: 'claude-sonnet-5', apiKey: '' })
  expect(mocks.write.mock.calls.filter((call) => call[1] === 'apiKey')).toEqual([
    ['agent', 'apiKey', ''],
  ])
})

it('retains the key through empty drafts and a model change within the same provider', () => {
  render('gpt-4.1')
  for (const value of ['', 'g', 'gpt-5.6-sol']) type(value)
  expect(mocks.values.apiKey).toBe('saved-key')
})

it('can reopen an incomplete saved model without inventing a previous provider', () => {
  expect(() => render('c')).not.toThrow()
  expect(() => type('claude-sonnet-5')).not.toThrow()
  expect(mocks.values.apiKey).toBe('saved-key')
})

it.each([
  ['c', 'saved-key'],
  ['gpt-4.1', ''],
])('uses only the selected block provider after switching to %s', (model, expectedKey) => {
  render('gpt-4.1')
  render(model, 'other-agent')
  type('claude-sonnet-5')
  expect(mocks.values.apiKey).toBe(expectedKey)
  expect(mocks.write.mock.calls.every((call) => call[0] === 'other-agent')).toBe(true)
})
