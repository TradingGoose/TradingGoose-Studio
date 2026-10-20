import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { FunctionBlock } from '@/blocks/blocks/function'
import { LoopBlock } from '@/blocks/blocks/loop'
import { ParallelContainerBlock } from '@/blocks/blocks/parallel_container'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import {
  createWorkflowTextFieldKey,
  extractPersistedStateFromDoc,
  readWorkflowMap,
  readWorkflowSnapshot,
  readWorkflowSnapshotCloned,
  readWorkflowTextFieldsMap,
  replaceWorkflowTextField,
  setWorkflowState,
  YJS_KEYS,
} from './workflow-session'

vi.unmock('@/blocks/registry')

describe('workflow session text fields', () => {
  it('materializes Y.Text-backed subblock values into workflow snapshots', () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    const textFields = readWorkflowTextFieldsMap(doc)

    workflowMap.set('blocks', {
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
            value: 'stale-block-value',
          },
        },
        outputs: {},
      },
    })
    workflowMap.set('edges', [])

    const sharedText = new Y.Text()
    sharedText.insert(0, 'live-ytext-value')
    textFields.set(createWorkflowTextFieldKey('block-1', 'code'), sharedText)

    expect(readWorkflowSnapshot(doc).blocks['block-1']?.subBlocks?.code?.value).toBe(
      'live-ytext-value'
    )
  })

  it('keeps existing Y.Text entries in sync when workflow state is replaced', () => {
    const doc = new Y.Doc()
    const textFields = readWorkflowTextFieldsMap(doc)

    const staleText = new Y.Text()
    staleText.insert(0, 'stale')
    textFields.set(createWorkflowTextFieldKey('block-1', 'code'), staleText)

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

    expect(textFields.get(createWorkflowTextFieldKey('block-1', 'code'))).toBeInstanceOf(Y.Text)
    expect(
      (textFields.get(createWorkflowTextFieldKey('block-1', 'code')) as Y.Text).toString()
    ).toBe('fresh')
    expect(readWorkflowSnapshot(doc).blocks['block-1']?.subBlocks?.code?.value).toBe('fresh')
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
      replaceWorkflowTextField(seed, 'container', fieldId, oldValue)
      const initialUpdate = Y.encodeStateAsUpdate(seed)
      const initialVector = Y.encodeStateVector(seed)
      const textClient = new Y.Doc()
      const graphClient = new Y.Doc()
      textClient.clientID = 2
      graphClient.clientID = 3
      for (const client of [textClient, graphClient]) Y.applyUpdate(client, initialUpdate)

      replaceWorkflowTextField(textClient, 'container', fieldId, newValue)
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
        expect(
          readWorkflowMap(merged).get(YJS_KEYS.BLOCKS).container.subBlocks[fieldId].value
        ).toBe(oldValue)
        const onUpdate = vi.fn()
        merged.on('update', onUpdate)
        const snapshot = readWorkflowSnapshot(merged)
        const cloned = readWorkflowSnapshotCloned(merged)
        const persisted = extractPersistedStateFromDoc(merged)
        expect(onUpdate).not.toHaveBeenCalled()

        // The delayed mirror only writes block values; derivation cannot rely on its timing.
        readWorkflowMap(merged).set(YJS_KEYS.BLOCKS, snapshot.blocks)
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
