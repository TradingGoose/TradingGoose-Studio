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
  readWorkflowSubBlockFieldsMap,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import type { WorkflowSessionContextValue } from '@/lib/yjs/workflow-session-host'
import { LoopBlock } from '@/blocks/blocks/loop'
import { ParallelContainerBlock } from '@/blocks/blocks/parallel_container'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { SerperBlock } from '@/blocks/blocks/serper'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { getWorkflowInspectorCopy } from '@/i18n/block-editor'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { buildTriggerEditingLayout } from '../trigger-editing-layout'
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

  function mount(
    config: SubBlockConfig,
    onChange?: (value: string) => void,
    blockId = 'container',
    disabled = false
  ) {
    act(() => {
      root.render(
        <ShortInput
          blockId={blockId}
          subBlockId={config.id}
          config={config}
          value={config.defaultValue ?? '5'}
          isConnecting={false}
          onChange={onChange}
          disabled={disabled}
        />
      )
    })
    return container.querySelector('input')!
  }

  function render(
    config: SubBlockConfig,
    blockConfig: BlockConfig = [
      LoopBlock,
      ParallelContainerBlock,
      PolymarketBlock,
      SerperBlock,
    ].find((block) => block.subBlocks.includes(config))!,
    options: Pick<BlockState, 'advancedMode' | 'triggerMode' | 'locked'> & {
      values?: Record<string, unknown>
    } = {}
  ) {
    fieldId = config.id
    const { values, ...blockProperties } = options
    setWorkflowState(doc, {
      blocks: {
        container: {
          id: 'container',
          type: blockConfig.type,
          name: 'Container',
          position: { x: 0, y: 0 },
          enabled: true,
          outputs: {},
          ...blockProperties,
          subBlocks: {
            ...buildInitialSubBlockStates(blockConfig.subBlocks, {
              operation: 'get_price_history',
              startTs: '5',
              endTs: '5',
              ...values,
            }),
            [config.id]: {
              id: config.id,
              type: config.type,
              value: values?.[config.id] ?? config.defaultValue ?? '5',
            },
          } as BlockState['subBlocks'],
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    const input = mount(config, undefined, 'container', blockProperties.locked === true)
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
    ['agent', 'memories', { advancedMode: false, locked: true }, {}],
    ['wealthbox', 'taskId', { advancedMode: true }, { operation: 'read_task' }],
    ['gmail', 'messageId', {}, { operation: 'read_gmail', folder: 'INBOX', manualFolder: '' }],
    ['github', 'webhookSecret', { triggerMode: true }, { selectedTriggerId: '' }],
  ] as const)(
    'mounts the text field exposed by the actual %s layout',
    (type, id, modes, values) => {
      const blockConfig = getBlock(type)!
      const config = blockConfig.subBlocks.find((field) => field.id === id)!
      let input!: HTMLInputElement
      expect(() => {
        input = render(config, blockConfig, { ...modes, values: { ...values, [id]: 'saved-text' } })
      }).not.toThrow()
      const block = readWorkflowSnapshot(doc).blocks.container
      const layout = buildTriggerEditingLayout({
        inspectorCopy: getWorkflowInspectorCopy('en'),
        blockType: type,
        blockId: 'container',
        blockConfig,
        blockState: block,
        shouldDisableWrite: block.locked === true,
      })
      expect(
        [
          ...layout.regularRows.flat(),
          ...(layout.displayAdditionalFields ? layout.additionalRows.flat() : []),
        ].map((field) => field.id)
      ).toContain(id)
      expect(input.value).toBe('saved-text')
      expect(savedValue()).toBe('saved-text')
      expect(readWorkflowSubBlockFieldsMap(doc).get('container')?.get(id)).toBeInstanceOf(Y.Text)
    }
  )

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
      const input = render(
        {
          ...PolymarketBlock.subBlocks.find((field) => field.id === 'startTs')!,
          min: 1,
        },
        PolymarketBlock
      )
      type(input, value)
      act(() => input.blur())
      expect(savedValue()).toBe(value)
      expect(readWorkflowSubBlockFieldsMap(doc).get('container')?.get('startTs')).toBe(value)
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
    const input = render(
      {
        ...SerperBlock.subBlocks.find((field) => field.id === 'query')!,
        integer: true,
        min: 1,
        max: 20,
      },
      SerperBlock
    )
    type(input, '1000')
    act(() => input.blur())
    expect(savedValue()).toBe('1000')
  })

  it.each([
    [LoopBlock, 'iterations', 'loops', 'same-field'],
    [ParallelContainerBlock, 'count', 'parallels', 'same-field'],
    [PolymarketBlock, 'startTs', null, 'same-field'],
    [SerperBlock, 'query', null, 'same-field'],
    [PolymarketBlock, 'startTs', null, 'same-block'],
    [PolymarketBlock, 'startTs', null, 'different-blocks'],
  ] as const)(
    'preserves scalar and text merge semantics (case %#)',
    (block, id, mapKey, scenario) => {
      doc.clientID = 1
      const config = block.subBlocks.find((field) => field.id === id)!
      render(config)
      act(() => root.render(null))
      const secondBlockId = scenario === 'different-blocks' ? 'other' : 'container'
      const secondFieldId = scenario === 'same-block' ? 'endTs' : id
      if (scenario === 'different-blocks') {
        const state = readWorkflowSnapshot(doc)
        setWorkflowState(doc, {
          ...state,
          blocks: {
            ...state.blocks,
            other: { ...state.blocks.container, id: 'other', name: 'Other' },
          },
        })
      }
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
        const editedConfig = block.subBlocks.find(
          (field) => field.id === (index === 0 ? id : secondFieldId)
        )!
        const input = mount(editedConfig, undefined, index === 0 ? 'container' : secondBlockId)
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
        const secondValue = snapshot.blocks[secondBlockId].subBlocks[secondFieldId].value
        mergedValues.push(JSON.stringify([value, secondValue]))
        if (scenario !== 'same-field') {
          expect([value, secondValue]).toEqual(['8', '9'])
        } else if (config.inputType === 'number') {
          expect(['8', '9']).toContain(value)
        } else {
          expect(value).toBe('89')
        }

        const fields: Array<[string, string, unknown]> =
          scenario === 'same-field'
            ? [['container', id, value]]
            : [
                ['container', id, '8'],
                [secondBlockId, secondFieldId, '9'],
              ]

        const restored = new Y.Doc()
        Y.applyUpdate(restored, Y.encodeStateAsUpdate(merged))
        for (const state of [
          snapshot,
          extractPersistedStateFromDoc(merged),
          readWorkflowSnapshot(restored),
        ]) {
          expect(validateWorkflowState(state).errors).toEqual([])
          const serialized = new Serializer().serializeWorkflow(
            state.blocks,
            state.edges,
            state.loops,
            state.parallels
          )
          for (const [blockId, fieldId, expected] of fields) {
            const stored = readWorkflowSubBlockFieldsMap(merged).get(blockId)?.get(fieldId)
            expect(stored instanceof Y.Text ? stored.toString() : stored).toBe(expected)
            expect(stored instanceof Y.Text).toBe(config.inputType !== 'number')
            expect(state.blocks[blockId].subBlocks[fieldId].value).toBe(expected)
            expect(
              serialized.blocks.find((item) => item.id === blockId)?.config.params[fieldId]
            ).toBe(expected)
          }
          if (mapKey) {
            expect(state[mapKey].container).toMatchObject({ [id]: Number(value) })
            expect(serialized[mapKey]?.container).toMatchObject({ [id]: Number(value) })
          }
        }
        restored.destroy()
        merged.destroy()
      }
      expect(new Set(mergedValues).size).toBe(1)
      for (const client of clients) client.destroy()
    }
  )
})
