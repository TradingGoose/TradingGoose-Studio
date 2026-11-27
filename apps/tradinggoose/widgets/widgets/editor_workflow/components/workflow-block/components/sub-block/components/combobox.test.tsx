/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { getReasoningOptions } from '@/lib/mastra/native-reasoning'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { readWorkflowSnapshot, setWorkflowState } from '@/lib/yjs/workflow-session'
import type { WorkflowSessionContextValue } from '@/lib/yjs/workflow-session-host'
import { AgentBlock } from '@/blocks/blocks/agent'
import { useModelRegistry } from '@/stores/model-registry'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { ComboBox } from './combobox'

const mocks = vi.hoisted(() => ({
  session: null as Pick<WorkflowSessionContextValue, 'doc' | 'transactWorkflow'> | null,
}))

vi.mock('@xyflow/react', () => ({ useReactFlow: () => null }))
vi.mock('@/hooks/queries/environment', () => ({
  usePersonalEnvironment: () => ({ data: {} }),
  useWorkspaceEnvironment: () => ({ data: { workspace: { MODEL: 'fixture' } } }),
}))
vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: () => null,
  checkTagTrigger: () => ({ show: false }),
}))
vi.mock('@/components/ui/formatted-text', () => ({ formatDisplayText: (value: string) => value }))
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

describe('late registry defaults and registry feedback', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc
  let queryClient: QueryClient
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  function Picker({
    fieldId,
    model,
    disabled,
  }: {
    fieldId: string
    model?: string
    disabled?: boolean
  }) {
    useModelRegistry((state) => state.providers)
    const config = AgentBlock.subBlocks.find(({ id }) => id === fieldId)!
    if (!evaluateSubBlockConditionValues(config.condition, { model })) return null
    return (
      <ComboBox
        blockId='agent'
        subBlockId={fieldId}
        inputId={fieldId}
        config={config}
        options={typeof config.options === 'function' ? config.options({ model }) : []}
        defaultValue={typeof config.value === 'function' ? config.value({ model }) : config.value}
        disabled={disabled}
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
  function mount(
    initial?: string,
    fields: string | string[] = 'model',
    reasoningEffort?: string | null,
    disabled?: boolean
  ) {
    setWorkflowState(doc, {
      blocks: {
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          position: { x: 0, y: 0 },
          enabled: true,
          outputs: {},
          subBlocks: buildInitialSubBlockStates(AgentBlock.subBlocks, {
            model: initial,
            reasoningEffort,
          }) as BlockState['subBlocks'],
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    const setDisabled = (value?: boolean) =>
      act(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            {(Array.isArray(fields) ? fields : [fields]).map((id) => (
              <Picker key={id} fieldId={id} model={initial} disabled={value} />
            ))}
          </QueryClientProvider>
        )
      )
    setDisabled(disabled)
    return setDisabled
  }
  const deepseek = 'deepseek/deepseek-v4-pro'
  function loadModel(id = 'openai/gpt-4.1') {
    const [provider] = id.split('/')
    act(() =>
      useModelRegistry.setState({
        providers: [
          {
            id: provider,
            name: provider,
            models: [{ id, reasoningOptions: getReasoningOptions(id) }],
          },
        ],
      })
    )
  }
  const savedEffort = () => readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.reasoningEffort.value
  function type(input: HTMLInputElement, value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  it('applies the listed default when metadata arrives for a new untouched field', () => {
    mount()
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBeNull()
    loadModel()
    expect(container.querySelector('input')!.value).toBe('openai/gpt-4.1')
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe('openai/gpt-4.1')
  })
  it('stores an available level on creation and restores it after clearing', () => {
    loadModel(deepseek)
    mount(deepseek, 'reasoningEffort')
    const input = container.querySelector('input')!
    expect(input.value).toBe('low')
    expect(savedEffort()).toBe('low')
    act(() => input.focus())
    expect(document.querySelector('[data-option-index="0"] .lucide-check')).not.toBeNull()
    act(() => document.querySelector<HTMLElement>('[data-option-index="1"]')!.click())
    expect(input.value).toBe('high')
    type(input, 'hi')
    loadModel(deepseek)
    expect(input.value).toBe('hi')
    expect(savedEffort()).toBe('hi')
    type(input, '')
    expect(input.value).toBe('low')
    expect(savedEffort()).toBe('low')
  })
  it.each([
    ['ready', 'medium', 'low'],
    ['late', 'medium', 'low'],
    ['late', 'max', 'max'],
    ['late', '{{EFFORT}}', '{{EFFORT}}'],
    ['late', '<upstream.level>', '<upstream.level>'],
  ])('with a %s catalog restores saved effort %s as %s', (timing, saved, expected) => {
    if (timing === 'ready') loadModel(deepseek)
    mount(deepseek, ['model', 'reasoningEffort'], saved)
    if (timing === 'late') {
      expect(container.querySelector('#model')).toHaveValue(deepseek)
      expect(container.querySelector('#reasoningEffort')).toBeNull()
      expect(savedEffort()).toBe(saved)
      loadModel(deepseek)
    }
    const input = container.querySelector<HTMLInputElement>('#reasoningEffort')!
    expect(input.value).toBe(expected)
    expect(savedEffort()).toBe(expected)
    act(() => input.focus())
    expect(
      Array.from(document.querySelectorAll('[data-option-index]'), (row) => row.textContent)
    ).toEqual(getReasoningOptions(deepseek)![0].values)
  })
  it.each([
    [null, 'low'],
    ['', 'low'],
    ['medium', 'low'],
    ['high', 'high'],
  ] as const)(
    'preserves %j while disabled and uses %s after editing is enabled',
    (saved, expected) => {
      const setDisabled = mount(deepseek, ['model', 'reasoningEffort'], saved, true)
      let updates = 0
      doc.on('update', () => updates++)
      expect(container.querySelector('#reasoningEffort')).toBeNull()
      loadModel(deepseek)
      const input = container.querySelector<HTMLInputElement>('#reasoningEffort')!
      expect(input).toBeDisabled()
      expect(updates).toBe(0)
      expect(savedEffort()).toBe(saved)
      setDisabled(false)
      expect(input).toBeEnabled()
      expect(input).toHaveValue(expected)
      expect(savedEffort()).toBe(expected)
      expect(updates).toBe(saved === expected ? 0 : 1)
    }
  )
  it('clears a stale saved level from the Model field when the model has no active levels', () => {
    mount('openai/gpt-4.1', 'model', 'medium')
    expect(savedEffort()).toBe('medium')
    loadModel()
    expect(container.querySelector('input')!.value).toBe('openai/gpt-4.1')
    expect(savedEffort()).toBe('')
  })
  it('retains effort on an unresolved model and clears it when switching to a known no-level model', () => {
    mount('unknown/model', 'model', 'high')
    loadModel()
    expect(savedEffort()).toBe('high')
    const input = container.querySelector('input')!
    type(input, 'openai/gpt-4.1')
    expect(input.value).toBe('openai/gpt-4.1')
    expect(savedEffort()).toBe('')
  })
  it.each(['', '{{MODEL}}', '<upstream.model>', 'gpt-4.1'])(
    'preserves explicit %s when registry arrives',
    (initial) => {
      mount(initial)
      loadModel()
      expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe(initial)
    }
  )
  it('restores an exact saved ID and distinguishes identical model names across providers', () => {
    const saved = 'deepseek/deepseek-v4-pro'
    mount(saved)
    const input = container.querySelector('input')!
    expect(input.value).toBe(saved)
    act(() =>
      useModelRegistry.setState({
        providers: ['deepseek', 'opencode'].map((id) => ({
          id,
          name: id,
          models: [{ id: `${id}/deepseek-v4-pro` }],
        })),
      })
    )
    expect(input.value).toBe(saved)
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe(saved)
    act(() => input.focus())
    expect(input.value).toBe(saved)
    expect(container.querySelector('[data-option-index]')).toBeNull()
    expect(document.querySelector('[data-option-index] .lucide-check')).not.toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="opencode"]')!.click())
    expect(document.querySelector('[data-option-index] .lucide-check')).toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('[data-option-index]')!.click())
    expect(input.value).toBe('opencode/deepseek-v4-pro')
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe(
      'opencode/deepseek-v4-pro'
    )
  })
  it('refreshes provider group names and icons when the registry arrives after opening', () => {
    mount('')
    act(() => document.querySelector('input')!.focus())
    expect(document.querySelector('[aria-label="OpenAI"]')).toBeNull()
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
      const group = document.querySelector(`button[aria-label="${name}"]`)
      expect(group).not.toBeNull()
      expect(group!.querySelector('svg, img')).not.toBeNull()
    }
    expect(document.querySelector('[data-option-index] > span.truncate')!.textContent).toBe(
      'gpt-4.1'
    )
    act(() =>
      document
        .querySelector('button[aria-label="Anthropic"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(document.querySelector('[data-option-index] > span.truncate')!.textContent).toBe(
      'claude-sonnet-5-5'
    )
  })
  it('reopens the options with a selected workspace reference still focused', () => {
    mount('')
    loadModel()
    const input = container.querySelector('input')!
    act(() => input.focus())
    expect(document.querySelector('[role="dialog"][data-open]')).not.toBeNull()
    type(input, '{{MO')
    const variable = container.querySelector<HTMLButtonElement>('[data-env-var-index="0"]')!
    expect(variable.textContent).toBe('MODEL')
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull()
    act(() => variable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe('{{MODEL}}')
    expect(container.querySelector('[data-env-var-index]')).toBeNull()
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull()
    expect(input).toHaveFocus()
    act(() => input.click())
    expect(document.querySelector('[data-option-index]')).toHaveTextContent('gpt-4.1')
    expect(input.value).toBe('{{MODEL}}')
  })
  it('opens all choices for a stale value and filters only while typing', () => {
    mount('removed/model')
    loadModel()
    const input = container.querySelector('input')!
    act(() => input.focus())
    expect(document.querySelector('[data-option-index]')).toHaveTextContent('gpt-4.1')
    type(input, 'zzz')
    expect(document.querySelector('[data-option-index]')).toBeNull()
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    act(() => input.click())
    act(() => document.querySelector<HTMLButtonElement>('[data-option-index]')!.click())
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe('openai/gpt-4.1')
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
    act(() => useModelRegistry.setState({ load: original }))
  })
})
