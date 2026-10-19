/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createYjsUndoTrackedOrigins, YJS_ORIGINS } from './transaction-origins'
import { bindWorkflowTextObserver } from './use-workflow-doc'
import {
  createWorkflowTextFieldKey,
  readWorkflowSnapshot,
  readWorkflowTextFieldsMap,
} from './workflow-session'

let container: HTMLDivElement | null = null
let root: Root | null = null
const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }

  root = null
  container?.remove()
  container = null
  vi.resetModules()
  vi.doUnmock('@/lib/yjs/workflow-session-host')
  vi.doUnmock('@/blocks')
})

afterAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

describe('workflow mutation helpers', () => {
  it('binds and cleans up existing Y.Text observers without double-unobserve errors', () => {
    const doc = new Y.Doc()
    const textFields = readWorkflowTextFieldsMap(doc)
    const text = new Y.Text()
    text.insert(0, 'hello')
    textFields.set(createWorkflowTextFieldKey('block-1', 'code'), text)

    const cb = vi.fn()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const observer = bindWorkflowTextObserver(textFields, 'block-1', 'code', cb)

    expect(() => observer.rebind()).not.toThrow()
    expect(() => observer.rebind()).not.toThrow()

    text.insert(text.length, ' world')
    expect(cb).toHaveBeenCalledTimes(1)

    expect(() => observer.cleanup()).not.toThrow()
    expect(() => observer.cleanup()).not.toThrow()
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

describe('useWorkflowBlocks', () => {
  it('materializes and observes Y.Text-backed subblock values in workflow blocks', async () => {
    const doc = new Y.Doc()
    const sharedText = new Y.Text()
    sharedText.insert(0, 'live-ytext-value')

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
    textFields.set(createWorkflowTextFieldKey('block-1', 'code'), sharedText)

    const session = { doc }
    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))

    const { useWorkflowBlocks } = await import('./use-workflow-doc')

    let latestBlocks: Record<string, any> = {}
    function Harness() {
      const blocks = useWorkflowBlocks()
      latestBlocks = blocks
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    expect(latestBlocks['block-1']?.subBlocks?.code?.value).toBe('live-ytext-value')

    await act(async () => {
      sharedText.delete(0, sharedText.length)
      sharedText.insert(0, 'fresh-ytext-value')
    })

    expect(latestBlocks['block-1']?.subBlocks?.code?.value).toBe('fresh-ytext-value')

    await act(async () => {
      sharedText.delete(0, sharedText.length)
      sharedText.insert(0, 'freshest-ytext-value')
    })

    expect(latestBlocks['block-1']?.subBlocks?.code?.value).toBe('freshest-ytext-value')
  })
})

describe('useWorkflowMutations', () => {
  async function mountContainerEditor(
    type: 'loop' | 'parallel',
    textFieldId = 'whileCondition',
    initialValues?: Record<string, unknown>
  ) {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    const session = {
      doc,
      transactWorkflow: (fn: (d: Y.Doc) => void, origin?: string) =>
        doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER),
    }
    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))
    vi.doMock('@/blocks', async () => {
      const { LoopBlock } = await import('@/blocks/blocks/loop')
      const { ParallelContainerBlock } = await import('@/blocks/blocks/parallel_container')
      return {
        getBlock: (blockType: string) =>
          blockType === 'loop'
            ? LoopBlock
            : blockType === 'parallel'
              ? ParallelContainerBlock
              : undefined,
      }
    })
    const { useWorkflowMutations, useWorkflowTextField } = await import('./use-workflow-doc')
    let mutations: ReturnType<typeof useWorkflowMutations> | null = null
    let textField: ReturnType<typeof useWorkflowTextField> | null = null
    let textFieldEnabled = initialValues === undefined
    function Harness() {
      mutations = useWorkflowMutations()
      textField = useWorkflowTextField('container-1', textFieldId, '', {
        enabled: textFieldEnabled,
        autoCreate: initialValues !== undefined,
      })
      return null
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(React.createElement(Harness)))
    await act(async () => {
      mutations?.addBlock(
        'container-1',
        type,
        'Research',
        { x: 0, y: 0 },
        { width: 400, height: 300 },
        undefined,
        undefined,
        { initialSubBlockValues: initialValues }
      )
    })
    if (initialValues) {
      textFieldEnabled = true
      await act(async () => root?.render(React.createElement(Harness)))
    }
    return {
      doc,
      workflowMap,
      get mutations() {
        return mutations!
      },
      get textField() {
        return textField!
      },
    }
  }

  it.each([
    {
      type: 'loop' as const,
      modeId: 'loopType',
      mode: 'forEach',
      fieldId: 'forEachItems',
      collection: ['NVDA', 'AAPL'],
    },
    {
      type: 'loop' as const,
      modeId: 'loopType',
      mode: 'forEach',
      fieldId: 'forEachItems',
      collection: { primary: 'NVDA', secondary: 'AAPL' },
    },
    {
      type: 'parallel' as const,
      modeId: 'parallelType',
      mode: 'collection',
      fieldId: 'distribution',
      collection: ['NVDA', 'AAPL'],
    },
    {
      type: 'parallel' as const,
      modeId: 'parallelType',
      mode: 'collection',
      fieldId: 'distribution',
      collection: { primary: 'NVDA', secondary: 'AAPL' },
    },
  ])(
    'preserves literal $type collections when mounting and editing a shared text field',
    async ({ type, modeId, mode, fieldId, collection }) => {
      const editor = await mountContainerEditor(type, fieldId, {
        [modeId]: mode,
        [fieldId]: collection,
      })

      expect(editor.textField.value).toBe(JSON.stringify(collection))
      expect(
        JSON.parse(
          readWorkflowSnapshot(editor.doc).blocks['container-1'].subBlocks[fieldId].value as string
        )
      ).toEqual(collection)
      if (type === 'loop') {
        expect(readWorkflowSnapshot(editor.doc).loops['container-1'].forEachItems).toEqual(
          collection
        )
      } else {
        expect(readWorkflowSnapshot(editor.doc).parallels['container-1'].distribution).toEqual(
          collection
        )
      }

      const replacement = { primary: 'MSFT', secondary: 'GOOG' }
      await act(async () => editor.mutations.setSubBlockValue('container-1', fieldId, replacement))

      expect(editor.textField.value).toBe(JSON.stringify(replacement))
      const state = readWorkflowSnapshot(editor.doc)
      expect(JSON.parse(state.blocks['container-1'].subBlocks[fieldId].value as string)).toEqual(
        replacement
      )
      expect(
        type === 'loop'
          ? state.loops['container-1'].forEachItems
          : JSON.parse(state.parallels['container-1'].distribution as string)
      ).toEqual(replacement)
    }
  )

  it.each([
    { type: 'loop' as const, fieldId: 'iterations', mapKey: 'loops', runtimeField: 'iterations' },
    { type: 'parallel' as const, fieldId: 'count', mapKey: 'parallels', runtimeField: 'count' },
  ])(
    'updates $type counts and derived execution state in one undoable transaction',
    async ({ type, fieldId, mapKey, runtimeField }) => {
      const editor = await mountContainerEditor(type)
      const undoManager = new Y.UndoManager(editor.workflowMap, {
        trackedOrigins: createYjsUndoTrackedOrigins(),
      })
      const changes = vi.fn(() => {
        const state = readWorkflowSnapshot(editor.doc)
        expect(state.blocks['container-1'].subBlocks[fieldId].value).toBe(9)
        expect((editor.workflowMap.get(mapKey) as any)['container-1'][runtimeField]).toBe(9)
      })
      editor.doc.on('update', changes)

      await act(async () => editor.mutations.setSubBlockValue('container-1', fieldId, 9))

      expect(changes).toHaveBeenCalledTimes(1)
      expect(readWorkflowSnapshot(editor.doc).blocks['container-1'].data).toEqual({
        width: 400,
        height: 300,
      })
      editor.doc.off('update', changes)
      await act(async () => undoManager.undo())
      expect(readWorkflowSnapshot(editor.doc).blocks['container-1'].subBlocks[fieldId].value).toBe(
        5
      )
      expect((editor.workflowMap.get(mapKey) as any)['container-1'][runtimeField]).toBe(5)
      undoManager.destroy()
    }
  )

  it('derives batch edits from live shared text and preserves inactive container values', async () => {
    const editor = await mountContainerEditor('loop')
    const sharedText = new Y.Text('old condition')
    await act(async () => {
      readWorkflowTextFieldsMap(editor.doc).set(
        createWorkflowTextFieldKey('container-1', 'whileCondition'),
        sharedText
      )
    })
    const changes = vi.fn()
    editor.doc.on('update', changes)

    await act(async () =>
      editor.mutations.batchSetSubBlockValues([
        { blockId: 'container-1', subBlockId: 'iterations', value: 11 },
        { blockId: 'container-1', subBlockId: 'forEachItems', value: '{{symbols}}' },
        { blockId: 'container-1', subBlockId: 'loopType', value: 'while' },
        { blockId: 'container-1', subBlockId: 'whileCondition', value: '{{keepGoing}}' },
      ])
    )

    const state = readWorkflowSnapshot(editor.doc)
    expect(state.blocks['container-1'].subBlocks.iterations.value).toBe(11)
    expect(state.blocks['container-1'].subBlocks.forEachItems.value).toBe('{{symbols}}')
    expect(state.blocks['container-1'].subBlocks.whileCondition.value).toBe('{{keepGoing}}')
    expect(state.loops['container-1']).toMatchObject({
      loopType: 'while',
      iterations: 11,
      whileCondition: '{{keepGoing}}',
    })
    expect(changes).toHaveBeenCalledTimes(1)
    editor.doc.off('update', changes)
  })

  it.each([
    {
      type: 'loop' as const,
      modeId: 'loopType',
      mode: 'forEach',
      fieldId: 'forEachItems',
      mapKey: 'loops',
      runtimeField: 'forEachItems',
    },
    {
      type: 'loop' as const,
      modeId: 'loopType',
      mode: 'doWhile',
      fieldId: 'whileCondition',
      mapKey: 'loops',
      runtimeField: 'whileCondition',
    },
    {
      type: 'parallel' as const,
      modeId: 'parallelType',
      mode: 'collection',
      fieldId: 'distribution',
      mapKey: 'parallels',
      runtimeField: 'distribution',
    },
  ])(
    'keeps $type $fieldId execution values current for generic and shared-text edits',
    async ({ type, modeId, mode, fieldId, mapKey, runtimeField }) => {
      const editor = await mountContainerEditor(type, fieldId)
      await act(async () => editor.mutations.setSubBlockValue('container-1', modeId, mode))
      await act(async () => editor.textField.setValue('{{first}}'))
      expect((editor.workflowMap.get(mapKey) as any)['container-1'][runtimeField]).toBe('{{first}}')
      await act(async () => editor.mutations.setSubBlockValue('container-1', fieldId, '{{second}}'))
      expect(editor.textField.value).toBe('{{second}}')
      expect((editor.workflowMap.get(mapKey) as any)['container-1'][runtimeField]).toBe(
        '{{second}}'
      )
    }
  )

  it.each([
    {
      blockType: 'loop' as const,
      mapKey: 'loops' as const,
      containerName: 'Loop',
    },
    {
      blockType: 'parallel' as const,
      mapKey: 'parallels' as const,
      containerName: 'Parallel',
    },
  ])(
    'keeps $mapKey in sync when adding nested blocks to a $blockType container',
    async ({ blockType, mapKey, containerName }) => {
      const doc = new Y.Doc()
      const workflowMap = doc.getMap('workflow')
      workflowMap.set('blocks', {})
      workflowMap.set('loops', {})
      workflowMap.set('parallels', {})

      const session = {
        doc,
        transactWorkflow: (fn: (d: Y.Doc) => void, origin?: string) => {
          doc.transact(() => fn(doc), origin ?? 'test')
        },
      }

      vi.resetModules()
      vi.doMock('@/lib/yjs/workflow-session-host', () => ({
        useOptionalWorkflowSession: () => session,
        useWorkflowSession: () => session,
      }))

      const { useWorkflowMutations } = await import('./use-workflow-doc')

      let mutations: any = null
      function Harness() {
        mutations = useWorkflowMutations()
        return null
      }

      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)

      await act(async () => {
        root?.render(React.createElement(Harness))
      })

      await act(async () => {
        mutations.addBlock('container-1', blockType, containerName, { x: 0, y: 0 })
      })

      expect((workflowMap.get(mapKey) as Record<string, any>)['container-1']?.nodes).toEqual([])

      await act(async () => {
        mutations.addBlock(
          'child-1',
          'script',
          'Script',
          { x: 100, y: 100 },
          undefined,
          'container-1',
          'parent'
        )
      })

      expect((workflowMap.get(mapKey) as Record<string, any>)['container-1']?.nodes).toEqual([
        'child-1',
      ])
    }
  )

  it('supports custom origins when updating block positions', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    workflowMap.set('blocks', {
      'block-1': {
        id: 'block-1',
        type: 'script',
        name: 'Script',
        enabled: true,
        position: { x: 10, y: 20 },
        subBlocks: {},
        outputs: {},
      },
    })
    workflowMap.set('edges', [])
    workflowMap.set('loops', {})
    workflowMap.set('parallels', {})

    const transactWorkflow = vi.fn((fn: (d: Y.Doc) => void, origin?: string) => {
      doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER)
    })
    const session = { doc, transactWorkflow }

    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))

    const { useWorkflowMutations } = await import('./use-workflow-doc')

    let mutations: ReturnType<typeof useWorkflowMutations> | null = null
    function Harness() {
      mutations = useWorkflowMutations()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    await act(async () => {
      mutations?.updateBlockPosition('block-1', { x: 30, y: 40 }, { origin: YJS_ORIGINS.SYSTEM })
    })

    expect(transactWorkflow).toHaveBeenCalledWith(expect.any(Function), YJS_ORIGINS.SYSTEM)
    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.position).toEqual({
      x: 30,
      y: 40,
    })

    await act(async () => {
      mutations?.updateBlockPosition('block-1', { x: 50, y: 60 })
    })

    expect(transactWorkflow).toHaveBeenLastCalledWith(expect.any(Function), YJS_ORIGINS.USER)
    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.position).toEqual({
      x: 50,
      y: 60,
    })
  })

  it('keeps reader variable mutations behind the session transaction gate', async () => {
    const doc = new Y.Doc()
    const before = Y.encodeStateAsUpdate(doc)
    const transactWorkflow = vi.fn()
    const session = { doc, transactWorkflow }

    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))

    const { useWorkflowMutations } = await import('./use-workflow-doc')
    let mutations: any = null
    function Harness() {
      mutations = useWorkflowMutations()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    expect([
      mutations?.addVariable({ workflowId: 'workflow-1', name: 'new', type: 'plain', value: '' }),
      mutations?.updateVariable('variable-1', { name: 'changed' }),
      mutations?.deleteVariable('variable-1'),
      mutations?.duplicateVariable('variable-1'),
    ]).toEqual(['', false, false, null])
    mutations?.replaceWorkflowState({ blocks: {}, edges: [], loops: {}, parallels: {} })

    expect(transactWorkflow).toHaveBeenCalledTimes(5)
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('allows typed block names unless another block already uses the normalized name', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    workflowMap.set('blocks', {
      'block-1': {
        id: 'block-1',
        type: 'script',
        name: 'Script 1',
        enabled: true,
        position: { x: 10, y: 20 },
        subBlocks: {},
        outputs: {},
      },
      'block-2': {
        id: 'block-2',
        type: 'script',
        name: 'Block 2',
        enabled: true,
        position: { x: 30, y: 40 },
        subBlocks: {},
        outputs: {},
      },
    })
    workflowMap.set('edges', [])
    workflowMap.set('loops', {})
    workflowMap.set('parallels', {})

    const session = {
      doc,
      transactWorkflow: (fn: (d: Y.Doc) => void, origin?: string) => {
        doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER)
      },
    }

    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))

    const { useWorkflowMutations } = await import('./use-workflow-doc')

    let mutations: ReturnType<typeof useWorkflowMutations> | null = null
    function Harness() {
      mutations = useWorkflowMutations()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    await act(async () => {
      mutations?.updateBlockName('block-1', 'Block 1')
    })

    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.name).toBe('Block 1')

    const updateSpy = vi.fn()
    doc.on('update', updateSpy)
    await act(async () => {
      expect(mutations?.updateBlockName('block-1', 'Block 1')).toBe(true)
    })
    doc.off('update', updateSpy)
    expect(updateSpy).not.toHaveBeenCalled()

    await act(async () => {
      mutations?.updateBlockName('block-1', 'Block 2')
    })

    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.name).toBe('Block 1')
  })

  it('rewrites block-name references in subBlocks and text fields when renaming a block', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    workflowMap.set('blocks', {
      'block-1': {
        id: 'block-1',
        type: 'script',
        name: 'My Block',
        enabled: true,
        position: { x: 10, y: 20 },
        subBlocks: {},
        outputs: {},
      },
      'block-2': {
        id: 'block-2',
        type: 'script',
        name: 'Consumer',
        enabled: true,
        position: { x: 30, y: 40 },
        subBlocks: {
          prompt: {
            id: 'prompt',
            type: 'long-input',
            value: 'Use <myblock.result> and <myblock>',
          },
          code: {
            id: 'code',
            type: 'code',
            value: 'return <myblock.output>',
          },
        },
        outputs: {},
      },
    })
    workflowMap.set('edges', [])
    workflowMap.set('loops', {})
    workflowMap.set('parallels', {})

    const textFieldKey = createWorkflowTextFieldKey('block-2', 'code')
    const sharedText = new Y.Text()
    sharedText.insert(0, 'return <myblock.output>')
    readWorkflowTextFieldsMap(doc).set(textFieldKey, sharedText)

    const session = {
      doc,
      transactWorkflow: (fn: (d: Y.Doc) => void, origin?: string) => {
        doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER)
      },
    }

    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))

    const { useWorkflowMutations } = await import('./use-workflow-doc')

    let mutations: ReturnType<typeof useWorkflowMutations> | null = null
    function Harness() {
      mutations = useWorkflowMutations()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    await act(async () => {
      mutations?.updateBlockName('block-1', 'Human Friendly Name')
    })

    const blocks = workflowMap.get('blocks') as Record<string, any>
    expect(blocks['block-1']?.name).toBe('Human Friendly Name')
    expect(blocks['block-2']?.subBlocks?.prompt?.value).toBe(
      'Use <humanfriendlyname.result> and <humanfriendlyname>'
    )
    expect(blocks['block-2']?.subBlocks?.code?.value).toBe('return <humanfriendlyname.output>')
    expect(sharedText.toString()).toBe('return <humanfriendlyname.output>')
  })

  it('clears parent-specific data when detaching a block from a container', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    workflowMap.set('blocks', {
      'block-1': {
        id: 'block-1',
        type: 'script',
        name: 'Script 1',
        enabled: true,
        position: { x: 10, y: 20 },
        subBlocks: {},
        outputs: {},
        data: {
          parentId: 'loop-1',
          extent: 'parent',
          width: 350,
          height: 180,
          locked: true,
        },
      },
    })
    workflowMap.set('edges', [])
    workflowMap.set('loops', {})
    workflowMap.set('parallels', {})

    const session = {
      doc,
      transactWorkflow: (fn: (d: Y.Doc) => void, origin?: string) => {
        doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER)
      },
    }

    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))

    const { useWorkflowMutations } = await import('./use-workflow-doc')

    let mutations: ReturnType<typeof useWorkflowMutations> | null = null
    function Harness() {
      mutations = useWorkflowMutations()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    await act(async () => {
      mutations?.updateParentId('block-1', '', 'parent')
    })

    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.data).toEqual({
      locked: true,
    })
  })
})

describe('useWorkflowTextField', () => {
  it('falls back to the block subblock value before a shared text field exists', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
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
            value: 'block-backed-value',
          },
        },
        outputs: {},
      },
    })

    const session = { doc }
    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))

    const { useWorkflowTextField } = await import('./use-workflow-doc')

    let latestValue = ''
    function Harness() {
      const hook = useWorkflowTextField('block-1', 'code', '', {
        autoCreate: false,
      })
      latestValue = hook.value
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    expect(latestValue).toBe('block-backed-value')
  })

  it('keeps delayed block mirrors out of the user undo stack', async () => {
    vi.useFakeTimers()
    try {
      const doc = new Y.Doc()
      const workflowMap = doc.getMap('workflow')
      const textFields = readWorkflowTextFieldsMap(doc)
      const sharedText = new Y.Text()
      sharedText.insert(0, '')
      textFields.set(createWorkflowTextFieldKey('block-1', 'code'), sharedText)

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
              value: '',
            },
          },
          outputs: {},
        },
      })

      const undoManager = new Y.UndoManager([workflowMap, textFields], {
        trackedOrigins: createYjsUndoTrackedOrigins(),
      })
      undoManager.clear()

      const session = {
        doc,
        transactWorkflow: (fn: (workflowDoc: Y.Doc) => void, origin?: string) =>
          doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER),
      }
      vi.resetModules()
      vi.doMock('@/lib/yjs/workflow-session-host', () => ({
        useOptionalWorkflowSession: () => session,
        useWorkflowSession: () => session,
      }))

      const { useWorkflowTextField } = await import('./use-workflow-doc')

      let setValue: (value: string) => void = () => {}
      function Harness() {
        const hook = useWorkflowTextField('block-1', 'code', '', {
          autoCreate: false,
          mirrorDelayMs: 25,
        })
        setValue = hook.setValue
        return null
      }

      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)

      await act(async () => {
        root?.render(React.createElement(Harness))
      })

      await act(async () => {
        setValue('hello')
        await vi.advanceTimersByTimeAsync(25)
      })

      expect(undoManager.undoStack.length).toBe(1)

      await act(async () => {
        undoManager.undo()
      })

      expect(undoManager.canUndo()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
