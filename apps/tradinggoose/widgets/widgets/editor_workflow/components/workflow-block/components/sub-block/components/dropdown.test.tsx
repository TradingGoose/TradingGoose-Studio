/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dataMode: '',
  data: '',
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

vi.mock('@/executor/handlers/response/response-handler', () => ({
  ResponseBlockHandler: {
    convertBuilderDataToJsonString: vi.fn(() => '{}'),
  },
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
      if (subBlockId === 'builderData') return [[], mocks.setBuilderData]
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

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
    const renderDropdown = async () => {
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

    await renderDropdown()
    expect(mocks.setBuilderData).not.toHaveBeenCalled()
    mocks.dataMode = 'structured'
    await renderDropdown()

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
})
