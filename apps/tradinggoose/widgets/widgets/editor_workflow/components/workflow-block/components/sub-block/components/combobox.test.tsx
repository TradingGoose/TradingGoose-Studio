/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
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
    expect(container.querySelector('input')!.value).toBe('gpt-4.1')
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe('openai/gpt-4.1')
  })
  it.each(['', '{{MODEL}}', '<upstream.model>', 'gpt-4.1'])(
    'preserves explicit %s when registry arrives',
    (initial) => {
      mount(initial)
      loadModels()
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
    expect(input.value).toBe('deepseek-v4-pro')
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe(saved)
    act(() => input.focus())
    expect(input.value).toBe(saved)
    expect(container.querySelector('[data-option-index]')).toBeNull()
    expect(document.querySelector('[data-option-index] .lucide-check')).not.toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="opencode"]')!.click())
    expect(document.querySelector('[data-option-index] .lucide-check')).toBeNull()
    act(() => document.querySelector<HTMLButtonElement>('[data-option-index]')!.click())
    expect(input.value).toBe('deepseek-v4-pro')
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
  it('closes the ordinary options so a workspace reference can be picked', () => {
    mount('')
    loadModels()
    const input = container.querySelector('input')!
    act(() => input.focus())
    expect(document.querySelector('[role="dialog"][data-open]')).not.toBeNull()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '{{MO')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const variable = container.querySelector<HTMLButtonElement>('[data-env-var-index="0"]')!
    expect(variable.textContent).toBe('MODEL')
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull()
    act(() => variable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe('{{MODEL}}')
    expect(container.querySelector('[data-env-var-index]')).toBeNull()
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull()
  })
  it('inserts dropped references into the stored value instead of a shortened label offset', async () => {
    mount('openai/gpt-4.1')
    loadModels()
    const input = container.querySelector('input')!
    expect(input.value).toBe('gpt-4.1')
    const drop = new Event('drop', { bubbles: true })
    Object.assign(drop, {
      dataTransfer: { getData: () => JSON.stringify({ type: 'connectionBlock' }) },
    })
    await act(async () => input.dispatchEvent(drop))
    expect(readWorkflowSnapshot(doc)!.blocks.agent.subBlocks.model.value).toBe('openai/gpt-4.1<')
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull()
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
