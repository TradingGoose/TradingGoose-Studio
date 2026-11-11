/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { useBlock } from '@/lib/yjs/use-workflow-doc'
import {
  readWorkflowSnapshot,
  setWorkflowState,
  setWorkflowSubBlockValues,
} from '@/lib/yjs/workflow-session'
import type { WorkflowSessionContextValue } from '@/lib/yjs/workflow-session-host'
import { AgentBlock } from '@/blocks/blocks/agent'
import { getReasoningEffortValues, useModelRegistry } from '@/stores/model-registry'

type ModelControl = 'reasoningEffort'
const chooserBlocks = [
  ...AgentBlock.subBlocks,
  {
    id: 'reasoningEffort',
    type: 'combobox' as const,
    additional: true,
    autoSelectFirstOption: false,
    condition: {
      field: 'model',
      operator: 'modelCapability' as const,
      value: 'reasoningEffort' as const,
    },
    options: (params?: Record<string, any>) => [
      { id: 'auto', label: 'Auto (provider default)' },
      ...(getReasoningEffortValues(params?.model ?? '') ?? []).map((id) => ({ id, label: id })),
    ],
  },
]

import type { BlockState } from '@/stores/workflows/workflow/types'
import { ComboBox, resolveComboBoxDisplayValue } from './combobox'

const mocks = vi.hoisted(() => ({
  session: null as Pick<WorkflowSessionContextValue, 'doc' | 'transactWorkflow'> | null,
}))

vi.mock('@xyflow/react', () => ({ useReactFlow: () => null }))
vi.mock('@/components/ui/env-var-dropdown', () => ({
  EnvVarDropdown: () => null,
  checkEnvVarTrigger: () => ({ show: false, searchTerm: '' }),
}))
vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: () => null,
  checkTagTrigger: () => ({ show: false }),
}))
vi.mock('@/components/ui/formatted-text', () => ({ formatDisplayText: (value: string) => value }))
vi.mock('@/hooks/use-tag-selection', () => ({ useTagSelection: () => vi.fn() }))
vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => null,
  useWorkspaceId: () => 'workspace',
}))
vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useOptionalWorkflowSession: () => mocks.session,
  useWorkflowSession: () => mocks.session,
}))

it.each([
  ['xhigh', false, false, true, false, ''],
  ['xhigh', true, false, true, false, 'xhigh'],
  ['xhigh', false, true, true, false, 'xhigh'],
  ['xhigh', false, false, false, false, 'xhigh'],
  ['<variable.effort>', false, false, true, false, '<variable.effort>'],
  ['{{REASONING_EFFORT}}', false, false, true, false, '{{REASONING_EFFORT}}'],
  ['high', false, false, true, true, 'high'],
] as const)(
  'resolves model-control display value %#',
  (value, selected, typed, capability, unresolved, expected) => {
    expect(resolveComboBoxDisplayValue(value, selected, typed, capability, unresolved)).toBe(
      expected
    )
  }
)

/** Renders the active Agent tuning field from its collaborative workflow snapshot. */
function AgentChooser({ field }: { field: ModelControl }) {
  const state = useBlock('agent')?.subBlocks ?? {}
  const config = buildSubBlockRows({
    subBlocks: chooserBlocks,
    stateToUse: state,
    isAdvancedMode: false,
    isTriggerMode: false,
    isPureTriggerBlock: false,
  })
    .flat()
    .find((entry) => entry.id === field)
  if (!config || typeof config.options !== 'function') return null
  return (
    <ComboBox
      blockId='agent'
      subBlockId={field}
      config={config}
      options={config.options({ model: state.model?.value })}
      contextValues={{ model: state.model?.value }}
      isConnecting={false}
    />
  )
}

describe('Agent tuning chooser interactions', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc
  let field: ModelControl
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    useModelRegistry.setState({
      providers: [
        {
          id: 'example',
          name: 'Example',
          models: [
            {
              id: 'example/first',
              reasoning: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
            },
            { id: 'example/second', reasoning: [{ type: 'effort', values: ['low', 'high'] }] },
            { id: 'example/plain', reasoning: [] },
          ],
        },
      ],
    })
    vi.useFakeTimers()
    environment.IS_REACT_ACT_ENVIRONMENT = true
    doc = new Y.Doc()
    mocks.session = {
      doc,
      transactWorkflow: (fn, origin) => doc.transact(() => fn(doc), origin),
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    doc.destroy()
    mocks.session = null
    vi.useRealTimers()
    environment.IS_REACT_ACT_ENVIRONMENT = false
  })

  function update(values: Record<string, unknown>) {
    act(() => {
      setWorkflowSubBlockValues(
        doc,
        Object.entries(values).map(([subBlockId, value]) => ({
          blockId: 'agent',
          subBlockId,
          value,
        }))
      )
    })
  }

  function input() {
    return container.querySelector('input')!
  }

  function open() {
    act(() => input().focus())
  }

  function close() {
    act(() => {
      input().blur()
      vi.runOnlyPendingTimers()
    })
  }

  function type(value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input(),
        value
      )
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function options() {
    return Array.from(container.querySelectorAll('[data-option-index] span')).map(
      (option) => option.textContent
    )
  }

  /** Lists the provider-default choice followed by levels supported by the current model. */
  function expectedOptions(model: string) {
    return ['Auto (provider default)', ...(getReasoningEffortValues(model) ?? [])]
  }

  /** Stores a real Agent snapshot and mounts its shared chooser against the Yjs document. */
  function renderChooser(id: ModelControl, model: string, value: string) {
    field = id
    setWorkflowState(doc, {
      blocks: {
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          position: { x: 0, y: 0 },
          enabled: true,
          outputs: {},
          subBlocks: buildInitialSubBlockStates(chooserBlocks, {
            model,
            [field]: value,
          }) as BlockState['subBlocks'],
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    act(() => root.render(<AgentChooser field={field} />))
  }

  it.each(
    (['reasoningEffort'] as const).flatMap((id) =>
      ['<variable.model>', '{{MODEL}}', '<upstream.model>'].map((model) => ({ id, model }))
    )
  )('preserves $id literals while model $model remains unresolved', ({ id, model }) => {
    renderChooser(id, model, 'high')
    expect(input().value).toBe('high')
    open()
    expect(options()).toEqual(['Auto (provider default)'])
    close()
    expect(input().value).toBe('high')
    act(() => root.render(<AgentChooser key='remounted' field={field} />))
    expect(input().value).toBe('high')

    open()
    type('medium')
    expect(input().value).toBe('medium')
    expect(options()).toEqual([])
    close()
    expect(input().value).toBe('medium')
    open()
    expect(options()).toEqual(['Auto (provider default)'])
    for (const reference of ['<variable.otherModel>', '{{OTHER_MODEL}}', '<other.model>']) {
      update({ model: reference })
      expect(input().value).toBe('medium')
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('medium')
    }

    type('deliberately-no-match')
    expect(container.textContent).toContain('No matching options found')
    expect(options()).toEqual([])
    close()
    expect(input().value).toBe('deliberately-no-match')
    open()
    expect(options()).toEqual(['Auto (provider default)'])
    const auto = container.querySelector('[data-option-index]')!
    act(() => auto.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('auto')
    open()
    type('')
    close()
    open()
    expect(input().value).toBe('')
    expect(options()).toEqual(['Auto (provider default)'])

    type('high')
    close()
    expect(input().value).toBe('high')
    const resolvedModel = 'example/first'
    update({ model: resolvedModel })
    open()
    expect(input().value).toBe('high')
    expect(options()).toEqual(expectedOptions(resolvedModel))
    update({ [field]: 'unavailable-level' })
    expect(input().value).toBe('')
    expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('unavailable-level')
    update({ model: 'example/plain' })
    expect(container.querySelector('input')).toBeNull()
    expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('unavailable-level')
  })

  it.each([['reasoningEffort', 'example/first', 'example/second']] as const)(
    'keeps %s editable through saved values, model changes and searches',
    (id, model, nextModel) => {
      renderChooser(id, model, '')
      open()
      expect(options()).toEqual(expectedOptions(model))
      expect(input().value).toBe('')

      const medium = Array.from(container.querySelectorAll('[data-option-index]')).find(
        (option) => option.textContent === 'medium'
      )!
      act(() => medium.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('medium')
      act(() => root.render(<AgentChooser key='reload' field={field} />))
      open()
      expect(input().value).toBe('medium')
      expect(options()).toEqual(expectedOptions(model))

      update({ model: nextModel })
      expect(options()).toEqual(expectedOptions(nextModel))
      update({ [field]: 'unavailable-level' })
      expect(input().value).toBe('')
      expect(options()).toEqual(expectedOptions(nextModel))
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe(
        'unavailable-level'
      )

      const auto = container.querySelector('[data-option-index]')!
      act(() => auto.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      open()
      type('')
      close()
      open()
      expect(options()).toEqual(expectedOptions(nextModel))
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('')
      type('definitely-no-match')
      expect(container.textContent).toContain('No matching options found')
      expect(options()).toEqual([])
      close()
      open()
      expect(options()).toEqual(expectedOptions(nextModel))

      for (const reference of ['<variable.model>', '{{MODEL}}', '<upstream.model>']) {
        update({ model: reference, [field]: '<variable.effort>' })
        close()
        open()
        expect(input().value).toBe('<variable.effort>')
        expect(options()).toEqual(['Auto (provider default)'])
        type('{{EFFORT}}')
        expect(input().value).toBe('{{EFFORT}}')
        expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('{{EFFORT}}')
      }

      update({ model: 'example/plain' })
      expect(container.querySelector('input')).toBeNull()
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('{{EFFORT}}')
    }
  )
})

describe('late registry defaults and registry feedback', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc
  let queryClient: QueryClient
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  function ModelPicker() {
    useModelRegistry((state) => state.providers)
    const config = AgentBlock.subBlocks.find(({ id }) => id === 'model')!
    return (
      <ComboBox
        blockId='agent'
        subBlockId='model'
        config={config}
        options={typeof config.options === 'function' ? config.options() : []}
        defaultValue={typeof config.value === 'function' ? config.value({}) : undefined}
        isConnecting={false}
      />
    )
  }
  beforeEach(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = true
    queryClient = new QueryClient()
    queryClient.setQueryData(['provider-icons'], {})
    useModelRegistry.setState({ providers: [], isLoading: false, error: undefined })
    doc = new Y.Doc()
    mocks.session = { doc, transactWorkflow: (fn, origin) => doc.transact(() => fn(doc), origin) }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    doc.destroy()
    mocks.session = null
    useModelRegistry.setState({ isLoading: false, error: undefined })
    environment.IS_REACT_ACT_ENVIRONMENT = false
  })
  function mount(initial?: string) {
    setWorkflowState(doc, {
      blocks: {
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          position: { x: 0, y: 0 },
          enabled: true,
          outputs: {},
          subBlocks: buildInitialSubBlockStates(
            AgentBlock.subBlocks,
            initial === undefined ? {} : { model: initial }
          ) as BlockState['subBlocks'],
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ModelPicker />
        </QueryClientProvider>
      )
    )
  }
  function loadModels() {
    act(() =>
      useModelRegistry.setState({
        providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'openai/gpt-4.1' }] }],
      })
    )
  }
  it('applies the listed default when metadata arrives for a new untouched field', () => {
    mount()
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBeNull()
    loadModels()
    expect(container.querySelector('input')!.value).toBe('openai/gpt-4.1')
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe('openai/gpt-4.1')
  })
  it.each(['', '{{MODEL}}', '<upstream.model>'])(
    'preserves explicit %s when registry arrives',
    (initial) => {
      mount(initial)
      loadModels()
      expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe(initial)
    }
  )
  it('refreshes provider group names and icons when the registry arrives after opening', () => {
    mount('')
    act(() => container.querySelector('input')!.focus())
    expect(container.querySelector('[aria-label="OpenAI"]')).toBeNull()
    act(() =>
      useModelRegistry.setState({
        providers: [
          { id: 'openai', name: 'OpenAI', models: [{ id: 'openai/gpt-4.1' }] },
          {
            id: 'anthropic',
            name: 'Anthropic',
            models: [{ id: 'anthropic/claude-sonnet-5-5' }],
          },
        ],
      })
    )

    for (const name of ['OpenAI', 'Anthropic']) {
      const group = container.querySelector(`button[aria-label="${name}"]`)
      expect(group).not.toBeNull()
      expect(group!.querySelector('svg, img')).not.toBeNull()
    }
    expect(container.querySelector('[data-option-index] > span.truncate')!.textContent).toBe(
      'openai/gpt-4.1'
    )
    act(() =>
      container
        .querySelector('button[aria-label="Anthropic"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(container.querySelector('[data-option-index] > span.truncate')!.textContent).toBe(
      'anthropic/claude-sonnet-5-5'
    )
  })
  it('announces loading and errors and retries through the existing registry action', () => {
    const load = vi.fn(async () => {})
    const original = useModelRegistry.getState().load
    act(() => useModelRegistry.setState({ isLoading: true, load }))
    mount('')
    expect(container.querySelector('[role=status]')).not.toBeNull()
    act(() => useModelRegistry.setState({ isLoading: false, error: 'network failed' }))
    expect(container.querySelector('[role=alert]')).not.toBeNull()
    const retry = container.querySelector('[role=alert] button')!
    act(() => retry.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(load).toHaveBeenCalledOnce()
    useModelRegistry.setState({ load: original })
  })
})
