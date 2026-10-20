import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { AgentBlock } from '@/blocks/blocks/agent'
import { FunctionBlock } from '@/blocks/blocks/function'
import { LoopBlock } from '@/blocks/blocks/loop'
import { ParallelContainerBlock } from '@/blocks/blocks/parallel_container'
import { TtsBlock } from '@/blocks/blocks/tts'
import { WaitBlock } from '@/blocks/blocks/wait'
import { getBlock } from '@/blocks/registry'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import {
  createWorkflowSnapshot,
  createWorkflowSubBlockFieldKey,
  extractPersistedStateFromDoc,
  readWorkflowMap,
  readWorkflowSnapshot,
  readWorkflowSnapshotCloned,
  readWorkflowSubBlockFieldsMap,
  readWorkflowSubBlockFieldValue,
  readWorkflowTextField,
  setWorkflowState,
  setWorkflowSubBlockValues,
  YJS_KEYS,
} from './workflow-session'

vi.unmock('@/blocks/registry')

describe('workflow session fields', () => {
  it('materializes canonical fields, derives outputs, and preserves null and synthetic values', () => {
    const doc = new Y.Doc()
    setWorkflowState(
      doc,
      createWorkflowSnapshot({
        blocks: {
          block: {
            id: 'block',
            type: 'agent',
            name: 'Agent',
            enabled: true,
            position: { x: 0, y: 0 },
            outputs: {},
            subBlocks: { responseFormat: { id: 'responseFormat', type: 'code', value: '' } },
          },
        },
      })
    )
    const responseFormat = JSON.stringify({
      type: 'object',
      properties: { symbol: { type: 'string' } },
    })
    const rawBlocks = readWorkflowMap(doc).get(YJS_KEYS.BLOCKS)
    setWorkflowSubBlockValues(doc, [
      { blockId: 'block', subBlockId: 'responseFormat', value: responseFormat },
      { blockId: 'block', subBlockId: '_toolSchema', value: { enabled: true } },
      { blockId: 'block', subBlockId: '_empty', value: null },
    ])
    setWorkflowSubBlockValues(doc, [
      {
        blockId: 'block',
        subBlockId: 'tool_code',
        value: 'return 1',
        collaborative: true,
      },
    ])
    expect(readWorkflowMap(doc).get(YJS_KEYS.BLOCKS)).toBe(rawBlocks)

    const snapshot = readWorkflowSnapshot(doc)
    expect(snapshot.blocks.block.subBlocks.responseFormat.value).toBe(responseFormat)
    expect(snapshot.blocks.block.outputs).toEqual({ symbol: 'string' })
    expect(snapshot.blocks.block.subBlocks._toolSchema.value).toEqual({ enabled: true })
    expect(snapshot.blocks.block.subBlocks._empty.value).toBeNull()
    expect(readWorkflowSubBlockFieldValue(doc, 'block', '_empty')).toBeNull()
    expect(readWorkflowSubBlockFieldValue(doc, 'block', 'missing')).toBeUndefined()
    expect(readWorkflowTextField(doc, 'block', 'tool_code')?.toString()).toBe('return 1')
    doc.destroy()
  })

  it('keeps existing Y.Text entries in sync when workflow state is replaced', () => {
    const doc = new Y.Doc()
    const textFields = readWorkflowSubBlockFieldsMap(doc)

    const staleText = new Y.Text()
    staleText.insert(0, 'stale')
    textFields.set(createWorkflowSubBlockFieldKey('block-1', 'code'), staleText)

    setWorkflowState(doc, {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'script',
          name: 'Script',
          enabled: true,
          position: { x: 0, y: 0 },
          subBlocks: {
            code: {
              id: 'code',
              type: 'code',
              value: 'fresh',
            },
          },
          outputs: {},
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })

    expect(textFields.get(createWorkflowSubBlockFieldKey('block-1', 'code'))).toBeInstanceOf(Y.Text)
    expect(
      (textFields.get(createWorkflowSubBlockFieldKey('block-1', 'code')) as Y.Text).toString()
    ).toBe('fresh')
    expect(readWorkflowSnapshot(doc).blocks['block-1']?.subBlocks?.code?.value).toBe('fresh')
  })

  it.each([
    [LoopBlock, 'iterations', '8', {}, false, false],
    [ParallelContainerBlock, 'count', '9', {}, false, false],
    [WaitBlock, 'timeValue', '<variable.delay>', {}, false, false],
    [TtsBlock, 'voice', 'alloy', { provider: 'openai' }, false, false],
    [TtsBlock, 'voice', 'cartesia-voice', { provider: 'cartesia' }, false, false],
    [
      getBlock('servicenow')!,
      'fields',
      '{}',
      { operation: 'servicenow_create_record' },
      true,
      false,
    ],
    [
      getBlock('webflow')!,
      'collectionId',
      'collection',
      { selectedTriggerId: 'webflow_collection_item_created' },
      false,
      false,
    ],
    [
      getBlock('webflow')!,
      'collectionId',
      'collection',
      { selectedTriggerId: 'webflow_collection_item_created' },
      false,
      true,
    ],
  ] as const)(
    'keeps field storage stable across widget variants (case %#)',
    (config, fieldId, value, params, collaborative, triggerMode) => {
      const doc = new Y.Doc()
      const block: BlockState = {
        id: 'block',
        type: config.type,
        name: config.name,
        position: { x: 0, y: 0 },
        enabled: true,
        triggerMode,
        outputs: {},
        subBlocks: buildInitialSubBlockStates(config.subBlocks, {
          ...params,
          [fieldId]: value,
        }) as BlockState['subBlocks'],
      }
      const state = createWorkflowSnapshot({ blocks: { block } })
      setWorkflowState(doc, state)
      const textFields = readWorkflowSubBlockFieldsMap(doc)
      const key = createWorkflowSubBlockFieldKey('block', fieldId)
      expect(textFields.get(key) instanceof Y.Text).toBe(collaborative)
      expect(readWorkflowSubBlockFieldValue(doc, 'block', fieldId)).toBe(value)
      expect(readWorkflowSnapshot(doc).blocks.block.subBlocks[fieldId].value).toBe(value)
      expect(extractPersistedStateFromDoc(doc).blocks.block.subBlocks[fieldId].value).toBe(value)
      setWorkflowSubBlockValues(doc, [
        {
          blockId: 'block',
          subBlockId: fieldId,
          value,
          collaborative: !collaborative,
        },
      ])
      expect(textFields.get(key) instanceof Y.Text).toBe(collaborative)
      doc.destroy()
    }
  )

  it('materializes many Agent blocks in one field traversal and preserves derived outputs', () => {
    const doc = new Y.Doc()
    const blocks = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => {
        const id = `agent-${index}`
        return [
          id,
          {
            id,
            type: 'agent',
            name: id,
            enabled: true,
            position: { x: 0, y: 0 },
            outputs: {},
            subBlocks: buildInitialSubBlockStates(AgentBlock.subBlocks) as BlockState['subBlocks'],
          },
        ]
      })
    )
    setWorkflowState(doc, createWorkflowSnapshot({ blocks }))
    const responseFormat = JSON.stringify({
      type: 'object',
      properties: { symbol: { type: 'string' } },
    })
    setWorkflowSubBlockValues(doc, [
      { blockId: 'agent-0', subBlockId: 'responseFormat', value: responseFormat },
    ])
    const fields = readWorkflowSubBlockFieldsMap(doc)
    const entries = fields.entries.bind(fields)
    let visited = 0
    const scan = vi.spyOn(fields, 'entries').mockImplementation(function* () {
      for (const entry of entries()) {
        visited++
        yield entry
      }
    })

    const snapshot = readWorkflowSnapshot(doc)
    expect(visited).toBeLessThanOrEqual(fields.size)
    expect(snapshot.blocks['agent-0'].subBlocks.responseFormat.value).toBe(responseFormat)
    expect(snapshot.blocks['agent-0'].outputs).toEqual({ symbol: 'string' })
    expect(snapshot.blocks['agent-99']).toBe(blocks['agent-99'])
    scan.mockRestore()
    doc.destroy()
  })

  it.each([
    [LoopBlock, 'while', 'whileCondition', 'false', 'true', 'loops'],
    [LoopBlock, 'doWhile', 'whileCondition', 'false', 'true', 'loops'],
    [LoopBlock, 'forEach', 'forEachItems', '["old"]', '["new"]', 'loops'],
    [ParallelContainerBlock, 'collection', 'distribution', '["old"]', '["new"]', 'parallels'],
  ] as const)(
    'derives canonical execution settings across concurrent edits (case %#)',
    (config, mode, fieldId, oldValue, newValue, mapKey) => {
      const container: BlockState = {
        id: 'container',
        type: config.type,
        name: 'Container',
        position: { x: 0, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: buildInitialSubBlockStates(config.subBlocks, {
          [config.type === 'loop' ? 'loopType' : 'parallelType']: mode,
          [fieldId]: oldValue,
        }) as BlockState['subBlocks'],
      }
      const seed = new Y.Doc()
      seed.clientID = 1
      const blocks = { container }
      setWorkflowState(seed, {
        blocks,
        edges: [],
        loops: generateLoopBlocks(blocks),
        parallels: generateParallelBlocks(blocks),
      })
      const initialUpdate = Y.encodeStateAsUpdate(seed)
      const initialVector = Y.encodeStateVector(seed)
      const textClient = new Y.Doc()
      const graphClient = new Y.Doc()
      textClient.clientID = 2
      graphClient.clientID = 3
      for (const client of [textClient, graphClient]) Y.applyUpdate(client, initialUpdate)

      textClient.transact(() => {
        setWorkflowSubBlockValues(textClient, [
          { blockId: 'container', subBlockId: fieldId, value: newValue },
        ])
      }, 'user')
      readWorkflowMap(graphClient).set(YJS_KEYS.BLOCKS, {
        ...readWorkflowMap(graphClient).get(YJS_KEYS.BLOCKS),
        unrelated: {
          ...container,
          id: 'unrelated',
          type: 'function',
          name: 'Unrelated',
          subBlocks: buildInitialSubBlockStates(FunctionBlock.subBlocks),
        },
      })
      const textUpdate = Y.encodeStateAsUpdate(textClient, initialVector)
      const graphUpdate = Y.encodeStateAsUpdate(graphClient, initialVector)

      for (const updates of [
        [textUpdate, graphUpdate],
        [graphUpdate, textUpdate],
      ]) {
        const merged = new Y.Doc()
        Y.applyUpdate(merged, initialUpdate)
        for (const update of updates) Y.applyUpdate(merged, update)
        const onUpdate = vi.fn()
        merged.on('update', onUpdate)
        const snapshot = readWorkflowSnapshot(merged)
        const cloned = readWorkflowSnapshotCloned(merged)
        const persisted = extractPersistedStateFromDoc(merged)
        expect(onUpdate).not.toHaveBeenCalled()

        const restored = new Y.Doc()
        Y.applyUpdate(restored, Y.encodeStateAsUpdate(merged))
        for (const state of [snapshot, cloned, persisted, extractPersistedStateFromDoc(restored)]) {
          expect(state.blocks.container.subBlocks[fieldId].value).toBe(newValue)
          expect(Object.keys(state.blocks)).toEqual(['container', 'unrelated'])
          expect(state[mapKey].container).toMatchObject({ [fieldId]: newValue, nodes: [] })
          const serialized = new Serializer().serializeWorkflow(
            state.blocks,
            state.edges,
            state.loops,
            state.parallels
          )
          expect(serialized[mapKey]?.container).toMatchObject({ [fieldId]: newValue })
        }

        cloned.blocks.container.name = 'Changed clone'
        cloned[mapKey].container.nodes.push('unrelated')
        expect(readWorkflowSnapshot(merged).blocks.container.name).toBe('Container')
        expect(readWorkflowSnapshot(merged)[mapKey].container.nodes).toEqual([])
        restored.destroy()
        merged.destroy()
      }
      textClient.destroy()
      graphClient.destroy()
      seed.destroy()
    }
  )
})
