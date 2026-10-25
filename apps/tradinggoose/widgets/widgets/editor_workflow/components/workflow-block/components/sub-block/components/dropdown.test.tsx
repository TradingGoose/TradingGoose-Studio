/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMinimalWorkflow, createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { InputResolver } from '@/executor/resolver/resolver'

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
    mocks.setValue.mockImplementation((value) => {
      mocks.dataMode = value
    })
    mocks.setData.mockImplementation((value) => {
      mocks.data = value
    })
    mocks.setBuilderData.mockImplementation((value) => {
      mocks.builderData = value
    })
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

  async function selectResponseMode(mode: 'structured' | 'json') {
    await act(async () => container.querySelector('button')!.click())
    const label = mode === 'structured' ? 'Builder' : 'Editor'
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === label
    )!
    await act(async () => item.click())
    await renderResponseMode()
  }

  it.each(['<start.details>', '[{"current":1}]', 'null', '"text"', '{bad JSON'])(
    'keeps unrepresentable Editor data in Editor: %s',
    async (data) => {
      mocks.data = data
      mocks.builderData = [{ id: 'stale', name: 'stale', type: 'string', value: 'old' }]
      mocks.dataMode = 'json'
      await renderResponseMode()
      await selectResponseMode('structured')
      expect(mocks.setValue).not.toHaveBeenCalled()
      expect(mocks.setBuilderData).not.toHaveBeenCalled()
      await selectResponseMode('json')
      expect(mocks.data).toBe(data)
      expect(mocks.setData).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['number', '<variable.amount>', 42],
    ['boolean', '{{ENABLED}}', false],
    ['object', '<start.details>', { cash: 1 }],
  ] as const)('keeps a dynamic %s cast in Builder', async (type, value, expected) => {
    const rows = [{ id: 'cast', name: 'cast', type, value }]
    mocks.builderData = rows
    mocks.data = '{"previous":1}'
    mocks.dataMode = 'structured'
    await renderResponseMode()
    await selectResponseMode('json')
    expect(mocks.setValue).not.toHaveBeenCalled()
    expect(mocks.setData).not.toHaveBeenCalled()
    expect(mocks.builderData).toBe(rows)
    const workflow = createMinimalWorkflow()
    const block = workflow.blocks[1]
    block.metadata = { id: 'response' }
    block.config.params = { dataMode: mocks.dataMode, builderData: mocks.builderData }
    const context = { ...createMockContext({ workflow }), triggerBlockId: 'trigger' }
    context.blockStates.set('trigger', { output: { details: '{"cash":1}' } })
    const resolver = new InputResolver(
      workflow,
      { ENABLED: 'false' },
      { amount: { name: 'amount', type: 'plain', value: '42' } },
      new Map()
    )
    const { response } = await new ResponseBlockHandler().execute(
      block,
      resolver.resolveInputs(block, context)
    )
    expect(response).toMatchObject({ status: 200, data: { cast: expected } })
  })

  it.each(['', '{}'])('clears stale rows for empty Editor data: %s', async (data) => {
    mocks.data = data
    mocks.builderData = [{ id: 'stale', name: 'stale', type: 'string', value: 'old' }]
    mocks.dataMode = 'json'
    await renderResponseMode()
    await selectResponseMode('structured')
    expect(mocks.builderData).toEqual([])
    await selectResponseMode('json')
    expect(JSON.parse(mocks.data)).toEqual({})
  })

  it.each(['json', '<variable.mode>'])(
    'preserves data when the mode is set externally: %s',
    async (mode) => {
      mocks.data = '[{"current":1}]'
      mocks.builderData = [{ id: 'stale', name: 'stale', type: 'string', value: 'old' }]
      mocks.dataMode = 'structured'
      await renderResponseMode()
      mocks.dataMode = mode
      await renderResponseMode()
      await selectResponseMode('json')
      expect(mocks.setData).not.toHaveBeenCalled()
      expect(mocks.data).toBe('[{"current":1}]')
    }
  )

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

  it('keeps malformed authored JSON visible without clearing Builder rows', async () => {
    mocks.builderData = [{ id: 'invalid', name: 'invalid', type: 'object', value: '{bad JSON' }]
    mocks.dataMode = 'structured'
    await renderResponseMode()
    await selectResponseMode('json')
    expect(mocks.data).toContain('"invalid": {bad JSON')
    await selectResponseMode('structured')
    expect(mocks.dataMode).toBe('json')
    expect(mocks.setBuilderData).not.toHaveBeenCalled()
  })

  it('preserves literals and reference quoting through Editor → Builder → Editor', async () => {
    const data = `{
  "number": 42,
  "boolean": false,
  "text": "{\\"x\\":1}",
  "details": {"native": <start.details>, "quoted": "<start.quantity>"},
  "positions": ["<start.details>", <start.details>, 0, false, null],
  "quoted": "<start.quantity>",
  "native": <start.quantity>,
  "sourceString": <start.accountId>,
  "quotedObject": "<start.details>",
  "quotedVariable": "<variable.quantity>",
  "nativeVariable": <variable.quantity>,
  "quotedNull": "<variable.nullable>",
  "environment": {{LIMIT}},
  "quotedEnvironment": "{{LIMIT}}",
  "escapedEnvironment": "{{TEXT}}",
  "environmentArray": {{ITEMS}}
}`
    const workflow = createMinimalWorkflow()
    const block = workflow.blocks[1]
    block.metadata = { id: 'response' }
    const context = { ...createMockContext({ workflow }), triggerBlockId: 'trigger' }
    context.blockStates.set('trigger', {
      output: { quantity: 0, accountId: '123', details: { text: 'Say "go"\\next\n' } },
    })
    const resolver = new InputResolver(
      workflow,
      { LIMIT: '42', ITEMS: '[1,2]', TEXT: 'Say "go"\\next\n$&' },
      {
        quantity: { name: 'quantity', type: 'number', value: 0 },
        nullable: { name: 'nullable', type: 'object', value: null },
      },
      new Map([[block.id, new Set(['trigger'])]])
    )
    mocks.data = data
    mocks.dataMode = 'json'
    await renderResponseMode()
    expect(mocks.setBuilderData).not.toHaveBeenCalled()
    await selectResponseMode('structured')
    await selectResponseMode('json')
    const converted = mocks.setData.mock.calls.at(-1)![0]
    expect(converted).toContain('"quoted": "<start.quantity>"')
    expect(converted).toContain('"sourceString": <start.accountId>')
    expect(converted).toContain('"environment": {{LIMIT}}')

    for (const dataMode of ['json', 'structured']) {
      block.config.params = { dataMode, data: converted, builderData: mocks.builderData }
      const { response } = await new ResponseBlockHandler().execute(
        block,
        resolver.resolveInputs(block, context)
      )
      expect(response.status).toBe(200)
      const details = context.blockStates.get('trigger')!.output.details
      expect(response.data).toStrictEqual({
        number: 42,
        boolean: false,
        text: '{"x":1}',
        details: { native: details, quoted: '0' },
        positions: [JSON.stringify(details), details, 0, false, null],
        quoted: '0',
        native: 0,
        sourceString: '123',
        quotedObject: JSON.stringify(details),
        quotedVariable: '0',
        nativeVariable: 0,
        quotedNull: 'null',
        environment: 42,
        quotedEnvironment: '42',
        escapedEnvironment: 'Say "go"\\next\n$&',
        environmentArray: [1, 2],
      })
    }
  })
})
