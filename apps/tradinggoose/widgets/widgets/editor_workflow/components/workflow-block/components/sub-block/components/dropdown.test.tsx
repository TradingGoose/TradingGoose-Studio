/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'

const mocks = vi.hoisted(() => ({
  dataMode: '',
  data: '',
  builderData: [] as Parameters<typeof ResponseBlockHandler.convertBuilderDataToJsonString>[0],
  setBuilderData: vi.fn(),
  setData: vi.fn(),
  setValue: vi.fn(),
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({ members: [], isLoading: false, error: null }),
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowBlocks: () => ({}),
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate',
  () => ({
    useDependsOnGate: () => ({
      finalDisabled: false,
      dependencyValues: [],
      dependsOn: [],
    }),
  })
)

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (_blockId: string, subBlockId: string) => {
      if (subBlockId === 'builderData') return [mocks.builderData, mocks.setBuilderData]
      if (subBlockId === 'data') return [mocks.data, mocks.setData]
      if (subBlockId === 'dataMode') return [mocks.dataMode, mocks.setValue]
      return ['', mocks.setValue]
    },
  })
)

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => null,
}))

vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowBlockEditorCopy: () => ({
    dropdown: {
      placeholder: 'Select an option',
      searchPlaceholder: 'Search options',
      noMatchingOptions: 'No matching options',
      noOptionsAvailable: 'No options available',
      loading: 'Loading',
    },
  }),
}))

import { Dropdown } from './dropdown'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('workflow Dropdown', () => {
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
    mocks.setBuilderData.mockReset()
    mocks.setData.mockReset()
    mocks.setValue.mockReset()
    mocks.dataMode = ''
    mocks.data = ''
    mocks.builderData = []
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  async function renderResponseMode() {
    await act(async () => {
      root.render(
        <Dropdown
          blockId='response-1'
          subBlockId='dataMode'
          options={[
            { id: 'structured', label: 'Builder' },
            { id: 'json', label: 'Editor' },
          ]}
        />
      )
    })
  }

  it('renders and opens through the native Base UI menu portal', async () => {
    await act(async () => {
      root.render(
        <Dropdown
          blockId='block-1'
          subBlockId='operation'
          options={[
            { id: 'first', label: 'First option', group: 'First group' },
            { id: 'second', label: 'Second option', group: 'Second group' },
          ]}
        />
      )
    })

    const trigger = container.querySelector('button')
    expect(trigger).toHaveTextContent('Select an option')
    expect(document.body).not.toHaveTextContent('First option')

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(document.body).toHaveTextContent('First option')
    expect(document.body).toHaveTextContent('First group')
    expect(document.body).toHaveTextContent('Second group')
    expect(container).not.toHaveTextContent('First option')
  })

  it('preserves object and array JSON text when switching from Editor to Builder', async () => {
    const data = {
      details: { message: '<start.input>', accountId: '123', quantity: 0, active: false },
      positions: ['<start.details>', { message: '<start.input>' }, 0, false, null],
      native: '<start.details>',
    }
    mocks.data = JSON.stringify(data)
    mocks.dataMode = 'json'
    await renderResponseMode()
    expect(mocks.setBuilderData).not.toHaveBeenCalled()
    mocks.dataMode = 'structured'
    await renderResponseMode()

    expect(mocks.setBuilderData).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({
        name: 'details',
        type: 'object',
        value: JSON.stringify(data.details, null, 2),
      }),
      expect.objectContaining({
        name: 'positions',
        type: 'array',
        value: JSON.stringify(data.positions, null, 2),
      }),
      expect.objectContaining({ name: 'native', type: 'string', value: data.native }),
    ])
  })

  it('preserves declared literals and quoted or bare templates through both mode changes', async () => {
    mocks.builderData = [
      { id: 'number', name: 'number', type: 'number', value: '42' },
      { id: 'boolean', name: 'boolean', type: 'boolean', value: 'false' },
      { id: 'object', name: 'object', type: 'object', value: '{"x":1}' },
      { id: 'array', name: 'array', type: 'array', value: '[1,2]' },
      { id: 'text', name: 'text', type: 'string', value: '{"x":1}' },
      { id: 'native', name: 'native', type: 'string', value: '<start.quantity>' },
      {
        id: 'details',
        name: 'details',
        type: 'object',
        value: '{"native":<start.positions>,"quoted":"<start.quantity>"}',
      },
      { id: 'environment', name: 'environment', type: 'number', value: '{{LIMIT}}' },
    ]
    mocks.dataMode = 'structured'
    await renderResponseMode()
    mocks.dataMode = 'json'
    await renderResponseMode()
    mocks.data = mocks.setData.mock.calls.at(-1)![0]
    expect(mocks.data).toContain('"native": <start.quantity>')
    expect(mocks.data).toContain('"environment": {{LIMIT}}')
    mocks.dataMode = 'structured'
    await renderResponseMode()
    const rows = mocks.setBuilderData.mock.calls.at(-1)![0]
    expect(rows).toEqual([
      expect.objectContaining({ name: 'number', type: 'number', value: 42 }),
      expect.objectContaining({ name: 'boolean', type: 'boolean', value: false }),
      expect.objectContaining({ name: 'object', type: 'object', value: '{\n  "x": 1\n}' }),
      expect.objectContaining({ name: 'array', type: 'array', value: '[\n  1,\n  2\n]' }),
      expect.objectContaining({ name: 'text', type: 'string', value: '{"x":1}' }),
      expect.objectContaining({ name: 'native', type: 'string', value: '<start.quantity>' }),
      expect.objectContaining({
        name: 'details',
        type: 'object',
        value: '{\n  "native": <start.positions>,\n  "quoted": "<start.quantity>"\n}',
      }),
      expect.objectContaining({ name: 'environment', value: '{{LIMIT}}' }),
    ])
  })

  it('keeps malformed authored JSON visible without clearing Builder rows', async () => {
    mocks.builderData = [{ id: 'invalid', name: 'invalid', type: 'object', value: '{bad JSON' }]
    mocks.dataMode = 'structured'
    await renderResponseMode()
    mocks.dataMode = 'json'
    await renderResponseMode()
    mocks.data = mocks.setData.mock.calls.at(-1)![0]
    expect(mocks.data).toContain('"invalid": {bad JSON')
    mocks.dataMode = 'structured'
    await renderResponseMode()
    expect(mocks.setBuilderData).not.toHaveBeenCalled()
  })
})
