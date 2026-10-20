/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { validateWorkflowState } from '@/lib/workflows/validation'
import {
  extractPersistedStateFromDoc,
  readWorkflowSnapshot,
  readWorkflowTextFieldValue,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import type { WorkflowSessionContextValue } from '@/lib/yjs/workflow-session-host'
import { LoopBlock } from '@/blocks/blocks/loop'
import { ParallelContainerBlock } from '@/blocks/blocks/parallel_container'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { SerperBlock } from '@/blocks/blocks/serper'
import type { SubBlockConfig } from '@/blocks/types'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { ShortInput } from './short-input'

const mocks = vi.hoisted(() => ({
  session: null as Pick<WorkflowSessionContextValue, 'doc' | 'transactWorkflow'> | null,
}))

vi.unmock('@/blocks/registry')

vi.mock('@xyflow/react', () => ({ useReactFlow: () => null }))

vi.mock('@/components/ui/env-var-dropdown', () => ({
  EnvVarDropdown: ({ visible }: { visible: boolean }) =>
    visible ? <div data-reference-picker='environment' /> : null,
  checkEnvVarTrigger: (value: string) => ({ show: value.includes('{{'), searchTerm: '' }),
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: ({ visible }: { visible: boolean }) =>
    visible ? <div data-reference-picker='workflow' /> : null,
  checkTagTrigger: (value: string) => ({ show: value.includes('<') }),
}))

vi.mock('@/components/ui/formatted-text', () => ({ formatDisplayText: (value: string) => value }))
vi.mock('@/hooks/use-tag-selection', () => ({ useTagSelection: () => vi.fn() }))
vi.mock('@/hooks/use-webhook-management', () => ({
  useWebhookManagement: () => ({ webhookUrl: '' }),
}))
vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => null,
}))
vi.mock('@/hooks/workflow/use-wand', () => ({ useWand: () => ({ isStreaming: false }) }))
vi.mock('@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar', () => ({
  WandPromptBar: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowBlockEditorCopy: () => ({ shortInput: {} }),
}))

vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useOptionalWorkflowSession: () => mocks.session,
  useWorkflowSession: () => mocks.session,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('ShortInput numeric contract', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc
  let fieldId: string
  const onUpdate = vi.fn<() => void>()

  function useDoc(nextDoc: Y.Doc) {
    mocks.session = {
      doc: nextDoc,
      transactWorkflow: (fn, origin) => nextDoc.transact(() => fn(nextDoc), origin),
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    doc = new Y.Doc()
    onUpdate.mockReset()
    doc.on('update', onUpdate)
    useDoc(doc)
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  function mount(config: SubBlockConfig, onChange?: (value: string) => void) {
    act(() => {
      root.render(
        <ShortInput
          blockId='container'
          subBlockId={config.id}
          config={config}
          value={config.defaultValue ?? '5'}
          isConnecting={false}
          onChange={onChange}
        />
      )
    })
    return container.querySelector('input')!
  }

  function render(config: SubBlockConfig, onChange?: (value: string) => void) {
    fieldId = config.id
    const blockConfig = [LoopBlock, ParallelContainerBlock, PolymarketBlock, SerperBlock].find(
      (block) => block.subBlocks.some((field) => field.id === config.id)
    )!
    setWorkflowState(doc, {
      blocks: {
        container: {
          id: 'container',
          type: blockConfig.type,
          name: 'Container',
          position: { x: 0, y: 0 },
          enabled: true,
          outputs: {},
          subBlocks: {
            ...buildInitialSubBlockStates(blockConfig.subBlocks, {
              operation: 'get_price_history',
            }),
            [config.id]: { id: config.id, type: config.type, value: config.defaultValue ?? '5' },
          } as BlockState['subBlocks'],
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    const input = mount(config, onChange)
    onUpdate.mockClear()
    return input
  }

  function savedValue() {
    return readWorkflowSnapshot(doc).blocks.container.subBlocks[fieldId].value
  }

  function type(input: HTMLInputElement, value: string) {
    act(() => {
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it.each([
    ['Loop', LoopBlock, 'iterations', 100],
    ['Parallel', ParallelContainerBlock, 'count', 20],
  ] as const)('bounds %s count before committing', (_name, block, id, max) => {
    const config = block.subBlocks.find((field) => field.id === id)!
    const input = render(config)
    type(input, '1000')
    expect(onUpdate).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(300))
    expect(savedValue()).toBe(String(max))

    act(() => input.blur())
    expect(input.value).toBe(String(max))
  })

  it.each([
    ['-10', '1'],
    ['4.7', '5'],
    ['1e999', '100'],
  ])('normalizes literal %s on blur to %s', (value, expected) => {
    const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
    type(input, value)
    act(() => input.blur())
    expect(savedValue()).toBe(expected)
    expect(input.value).toBe(expected)
  })

  it('bounds a pending count when the editor unmounts before debounce or blur', () => {
    const input = render(ParallelContainerBlock.subBlocks.find((field) => field.id === 'count')!)
    type(input, '1000')
    act(() => root.render(null))
    expect(savedValue()).toBe('20')
    expect(onUpdate).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(300))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it.each(['<variable.count>', '{{COUNT}}', '', 'text'])(
    'rejects invalid count %j without changing the saved value',
    (value) => {
      const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
      type(input, value)
      expect(container.querySelector('[data-reference-picker]')).toBeNull()
      act(() => input.blur())
      expect(onUpdate).not.toHaveBeenCalled()
      expect(savedValue()).toBe(5)
      expect(input.value).toBe('5')
    }
  )

  it('preserves the last committed literal when unmounting with a pasted reference', () => {
    const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
    type(input, '7')
    act(() => input.blur())
    onUpdate.mockClear()

    type(input, '<variable.count>')
    act(() => root.render(null))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(savedValue()).toBe('7')
  })

  it('ignores reference drops on fields that declare no reference support', () => {
    const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: () => JSON.stringify({ type: 'connectionBlock' }) },
    })
    act(() => input.dispatchEvent(drop))
    expect(input.value).toBe('5')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it.each(['<variable.startTime>', '{{START_TIME}}', '', '1e'])(
    'preserves reference or incomplete numeric text %j',
    (value) => {
      const input = render({
        ...PolymarketBlock.subBlocks.find((field) => field.id === 'startTs')!,
        min: 1,
      })
      type(input, value)
      act(() => input.blur())
      expect(savedValue()).toBe(value)
      expect(readWorkflowTextFieldValue(doc, 'container', 'startTs')).toBeNull()
    }
  )

  it('preserves fractional numeric values for controlled short inputs', () => {
    const onChange = vi.fn()
    mocks.session = null
    const input = mount(
      { id: 'speed', type: 'short-input', inputType: 'number', min: 0.25, max: 4 },
      onChange
    )
    type(input, '1.5')
    act(() => input.blur())
    expect(onChange).toHaveBeenLastCalledWith('1.5')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not apply numeric constraints to text inputs', () => {
    const input = render({
      ...SerperBlock.subBlocks.find((field) => field.id === 'query')!,
      integer: true,
      min: 1,
      max: 20,
    })
    type(input, '1000')
    act(() => input.blur())
    expect(savedValue()).toBe('1000')
  })

  it.each([
    [LoopBlock, 'iterations', 'loops'],
    [ParallelContainerBlock, 'count', 'parallels'],
    [PolymarketBlock, 'startTs', null],
    [SerperBlock, 'query', null],
  ] as const)('preserves scalar and text merge semantics (case %#)', (block, id, mapKey) => {
    doc.clientID = 1
    const config = block.subBlocks.find((field) => field.id === id)!
    render(config)
    act(() => root.render(null))
    const initialUpdate = Y.encodeStateAsUpdate(doc)
    const initialVector = Y.encodeStateVector(doc)
    const clients = [2, 3].map((clientId) => {
      const client = new Y.Doc()
      client.clientID = clientId
      Y.applyUpdate(client, initialUpdate)
      return client
    })
    const edits = clients.map((client, index) => {
      useDoc(client)
      const input = mount(config)
      type(input, String(index + 8))
      act(() => input.blur())
      act(() => root.render(null))
      return Y.encodeStateAsUpdate(client, initialVector)
    })

    const mergedValues = []
    for (const updates of [edits, [...edits].reverse()]) {
      const merged = new Y.Doc()
      Y.applyUpdate(merged, initialUpdate)
      for (const update of updates) Y.applyUpdate(merged, update)
      const snapshot = readWorkflowSnapshot(merged)
      const value = snapshot.blocks.container.subBlocks[id].value
      mergedValues.push(value)
      if (config.inputType === 'number') {
        expect(['8', '9']).toContain(value)
        expect(readWorkflowTextFieldValue(merged, 'container', id)).toBeNull()
      } else {
        expect(value).toBe('89')
        expect(readWorkflowTextFieldValue(merged, 'container', id)).toBe(value)
      }

      for (const state of [snapshot, extractPersistedStateFromDoc(merged)]) {
        expect(state.blocks.container.subBlocks[id].value).toBe(value)
        expect(validateWorkflowState(state).errors).toEqual([])
        const serialized = new Serializer().serializeWorkflow(
          state.blocks,
          state.edges,
          state.loops,
          state.parallels
        )
        expect(serialized.blocks[0].config.params[id]).toBe(value)
        if (mapKey) {
          expect(state[mapKey].container).toMatchObject({ [id]: Number(value) })
          expect(serialized[mapKey]?.container).toMatchObject({ [id]: Number(value) })
        }
      }
      merged.destroy()
    }
    expect(new Set(mergedValues).size).toBe(1)
    for (const client of clients) client.destroy()
  })
})
