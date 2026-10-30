/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createYjsUndoTrackedOrigins, YJS_ORIGINS } from './transaction-origins'
import {
  createWorkflowSnapshot,
  extractPersistedStateFromDoc,
  readWorkflowSnapshot,
  readWorkflowSubBlockFieldsMap,
  setWorkflowState,
} from './workflow-session'

vi.unmock('@/blocks/registry')

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

describe('model editor credentials', () => {
  it.each(
    ['', 'c', '{{MODEL}}', '<agent1.model>', '<variable.model>'].flatMap((unresolved) =>
      [false, true].map((reopen) => ({ unresolved, reopen }))
    )
  )(
    'clears mismatched credentials after $unresolved model edits (reopen=$reopen)',
    async ({ unresolved, reopen }) => {
      const tuning = Object.fromEntries(
        Object.entries({ reasoningEffort: 'high', verbosity: 'low', thinkingLevel: 'high' }).map(
          ([id, value]) => [id, { id, type: 'combobox' as const, value }]
        )
      )
      const doc = new Y.Doc()
      setWorkflowState(
        doc,
        createWorkflowSnapshot({
          blocks: {
            'block-1': {
              id: 'block-1',
              type: 'agent',
              name: 'Agent',
              enabled: true,
              position: { x: 0, y: 0 },
              outputs: {},
              subBlocks: {
                ...tuning,
                model: { id: 'model', type: 'combobox', value: 'gpt-4.1' },
                apiKey: { id: 'apiKey', type: 'short-input', value: 'openai-key' },
              },
            },
          },
        })
      )
      const session = {
        doc,
        readWorkflowSnapshot: () => readWorkflowSnapshot(doc),
        transactWorkflow: (fn: (doc: Y.Doc) => void, origin?: string) =>
          doc.transact(() => fn(doc), origin),
      }
      vi.doMock('@/lib/yjs/workflow-session-host', () => ({
        useOptionalWorkflowSession: () => session,
        useWorkflowSession: () => session,
      }))
      const { useSubBlockValue } = await import(
        '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
      )
      let model!: ReturnType<typeof useSubBlockValue<string>>
      function Harness() {
        model = useSubBlockValue<string>('block-1', 'model')
        return null
      }
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      await act(async () => root?.render(React.createElement(Harness)))
      const apiKey = () => readWorkflowSnapshot(doc).blocks['block-1'].subBlocks.apiKey.value

      for (const value of [unresolved, 'gpt-5.4', unresolved]) {
        await act(async () => model[1](value))
        expect(model[0]).toBe(value)
        expect(apiKey()).toBe('openai-key')
        expect(readWorkflowSnapshot(doc).blocks['block-1'].subBlocks).toMatchObject(tuning)
      }
      if (reopen) {
        await act(async () => root?.render(React.createElement(Harness, { key: 'reopened' })))
        expect(model[0]).toBe(unresolved)
        expect(apiKey()).toBe('openai-key')
        expect(readWorkflowSnapshot(doc).blocks['block-1'].subBlocks).toMatchObject(tuning)
      }
      await act(async () => model[1]('claude-sonnet-5-5'))
      expect(apiKey()).toBe('')
    }
  )
})

describe('useWorkflowBlocks', () => {
  it('materializes and observes Y.Text-backed subblock values in workflow blocks', async () => {
    const doc = new Y.Doc()
    const sharedText = new Y.Text()
    sharedText.insert(0, 'live-ytext-value')

    const textFields = readWorkflowSubBlockFieldsMap(doc)
    setWorkflowState(
      doc,
      createWorkflowSnapshot({
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
                value: 'stale-block-value',
              },
            },
            outputs: {},
          },
        },
      })
    )
    textFields.get('block-1')!.set('code', sharedText)

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

describe('useBlock', () => {
  it('scopes reads and drag updates while observing remote, replacement, and restored fields', async () => {
    const source = new Y.Doc()
    setWorkflowState(
      source,
      createWorkflowSnapshot({
        blocks: Object.fromEntries(
          ['target', 'neighbor'].map((id) => [
            id,
            {
              id,
              type: 'function',
              name: id,
              enabled: true,
              position: { x: 0, y: 0 },
              outputs: {},
              subBlocks: { code: { id: 'code', type: 'code', value: 'return 1' } },
            },
          ])
        ),
      })
    )
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source))
    const session = { doc }
    vi.resetModules()
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))
    const { useBlock } = await import('./use-workflow-doc')
    const latest: Record<string, ReturnType<typeof useBlock>> = {}
    const renders = { target: 0, neighbor: 0 }
    function Harness({ id }: { id: keyof typeof renders }) {
      latest[id] = useBlock(id)
      renders[id]++
      return null
    }
    const fields = readWorkflowSubBlockFieldsMap(doc)
    const scans = [
      vi.spyOn(fields, Symbol.iterator),
      vi.spyOn(fields, 'keys'),
      vi.spyOn(fields, 'entries'),
      vi.spyOn(fields, 'values'),
    ]
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Harness, { id: 'target' }),
          React.createElement(Harness, { id: 'neighbor' })
        )
      )
    })
    const targetRenders = renders.target
    await act(async () => {
      const workflow = doc.getMap('workflow')
      const blocks = workflow.get('blocks') as Record<string, any>
      workflow.set('blocks', {
        ...blocks,
        neighbor: { ...blocks.neighbor, position: { x: 10, y: 20 } },
      })
    })
    expect(renders.target).toBe(targetRenders)
    expect(latest.neighbor?.position).toEqual({ x: 10, y: 20 })

    const targetFields = fields.get('target')!
    const previousText = targetFields.get('code') as Y.Text
    await act(async () => targetFields.set('code', new Y.Text('replacement')))
    expect(latest.target?.subBlocks.code.value).toBe('replacement')
    await act(async () => previousText.insert(0, 'detached'))
    expect(latest.target?.subBlocks.code.value).toBe('replacement')

    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    const remoteFields = readWorkflowSubBlockFieldsMap(remote).get('target')!
    remoteFields.set('synthetic', new Y.Text('remote'))
    await act(async () => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote)))
    expect(latest.target?.subBlocks.synthetic.value).toBe('remote')
    const undo = new Y.UndoManager(fields, { captureTimeout: 0 })
    await act(async () => targetFields.delete('synthetic'))
    expect(latest.target?.subBlocks.synthetic).toBeUndefined()
    await act(async () => undo.undo())
    expect(latest.target?.subBlocks.synthetic.value).toBe('remote')
    await act(async () => (targetFields.get('synthetic') as Y.Text).insert(6, ' edit'))
    expect(latest.target?.subBlocks.synthetic.value).toBe('remote edit')
    for (const scan of scans) expect(scan).not.toHaveBeenCalled()
    for (const scan of scans) scan.mockRestore()
    undo.destroy()
    source.destroy()
    remote.destroy()
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
    const { useWorkflowMutations, useWorkflowField, useWorkflowLoops, useWorkflowParallels } =
      await import('./use-workflow-doc')
    let mutations: ReturnType<typeof useWorkflowMutations> | null = null
    let textField: ReturnType<typeof useWorkflowField> | null = null
    let loops: ReturnType<typeof useWorkflowLoops> = {}
    let parallels: ReturnType<typeof useWorkflowParallels> = {}
    let editorOpen = false
    function TextEditor() {
      textField = useWorkflowField('container-1', textFieldId)
      return null
    }
    function Harness() {
      mutations = useWorkflowMutations()
      loops = useWorkflowLoops()
      parallels = useWorkflowParallels()
      return editorOpen ? React.createElement(TextEditor) : null
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
    editorOpen = true
    await act(async () => root?.render(React.createElement(Harness)))
    return {
      doc,
      workflowMap,
      async closeEditor() {
        editorOpen = false
        await act(async () => root?.render(React.createElement(Harness)))
      },
      get mutations() {
        return mutations!
      },
      get textField() {
        return textField!
      },
      get loops() {
        return loops
      },
      get parallels() {
        return parallels
      },
    }
  }

  it.each([
    ['loop', 'while', 'whileCondition', 'loops'],
    ['loop', 'doWhile', 'whileCondition', 'loops'],
    ['loop', 'forEach', 'forEachItems', 'loops'],
    ['parallel', 'collection', 'distribution', 'parallels'],
  ] as const)(
    'preserves %s %s execution values through generic, structural, and remote edits',
    async (type, mode, fieldId, mapKey) => {
      const editor = await mountContainerEditor(type, fieldId, {
        [fieldId]: '<upstream.previous> <variable.old>',
      })
      await act(async () => {
        editor.mutations.setSubBlockValue(
          'container-1',
          type === 'loop' ? 'loopType' : 'parallelType',
          mode
        )
        editor.mutations.addBlock('upstream', 'loop', 'Upstream', { x: 0, y: 0 })
        editor.mutations.addBlock('other-container', type, 'Other Container', { x: 500, y: 0 })
        editor.mutations.addVariable(
          { workflowId: 'wf', name: 'old', type: 'plain', value: '' },
          'var'
        )
      })
      await act(async () => editor.textField.setValue('<upstream.current> <variable.old>'))
      expect(editor.textField.value).toBe('<upstream.current> <variable.old>')
      expect(readWorkflowSnapshot(editor.doc)).toMatchObject({
        [mapKey]: {
          'container-1': { [fieldId]: '<upstream.current> <variable.old>' },
        },
      })
      await act(async () => editor.mutations.setSubBlockValue('container-1', fieldId, '{{second}}'))
      expect(editor.textField.value).toBe('{{second}}')
      expect(readWorkflowSnapshot(editor.doc)).toMatchObject({
        [mapKey]: { 'container-1': { [fieldId]: '{{second}}' } },
      })
      await act(async () => editor.textField.setValue('<upstream.current> <variable.old>'))
      await editor.closeEditor()

      function expectPersisted(nodes: string[], value = '<upstream.current> <variable.old>') {
        const persisted = extractPersistedStateFromDoc(editor.doc)
        expect(persisted.blocks['container-1'].subBlocks[fieldId].value).toBe(value)
        expect(persisted[mapKey]['container-1']).toMatchObject({ [fieldId]: value, nodes })
        return persisted
      }

      await act(async () =>
        editor.mutations.addBlock(
          'child',
          'function',
          'Function',
          { x: 0, y: 0 },
          undefined,
          'container-1'
        )
      )
      expectPersisted(['child'])
      await act(async () => editor.mutations.setBlockTriggerMode('upstream', true))
      expectPersisted(['child'])

      await act(async () => editor.mutations.updateParentId('child', 'other-container', 'parent'))
      expect(expectPersisted([])[mapKey]['other-container'].nodes).toEqual(['child'])

      await act(async () => {
        editor.mutations.updateParentIds([
          { id: 'child', parentId: 'container-1', extent: 'parent' },
        ])
      })
      expect(expectPersisted(['child'])[mapKey]['other-container'].nodes).toEqual([])

      await act(async () => {
        expect(editor.mutations.updateBlockName('upstream', 'Renamed Source')).toBe(true)
      })
      expectPersisted(['child'], '<renamedsource.current> <variable.old>')

      await act(async () => {
        expect(editor.mutations.updateVariable('var', { name: 'new' })).toBe(true)
      })
      expectPersisted(['child'], '<renamedsource.current> <variable.new>')

      await act(async () => editor.mutations.removeBlock('child'))
      expectPersisted([], '<renamedsource.current> <variable.new>')

      const remote = new Y.Doc()
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(editor.doc))
      const remoteText = readWorkflowSubBlockFieldsMap(remote)
        .get('container-1')!
        .get(fieldId) as Y.Text
      remoteText.insert(remoteText.length, ' + remote')
      const changes = vi.fn()
      editor.doc.on('update', changes)
      await act(async () => Y.applyUpdate(editor.doc, Y.encodeStateAsUpdate(remote), 'remote'))
      const remoteValue = '<renamedsource.current> <variable.new> + remote'
      expectPersisted([], remoteValue)
      expect({ loops: editor.loops, parallels: editor.parallels }).toMatchObject({
        [mapKey]: { 'container-1': { [fieldId]: remoteValue } },
      })
      expect(changes).toHaveBeenCalledTimes(1)
      editor.doc.off('update', changes)
      remote.destroy()
    }
  )

  it.each([
    {
      type: 'loop' as const,
      modeId: 'loopType',
      mode: 'forEach',
      fieldId: 'forEachItems',
      collection: ['NVDA', 'AAPL'],
    },
    {
      type: 'parallel' as const,
      modeId: 'parallelType',
      mode: 'collection',
      fieldId: 'distribution',
      collection: ['NVDA', 'AAPL'],
    },
  ])(
    'preserves literal $type collections when mounting and editing a shared text field',
    async ({ type, modeId, mode, fieldId, collection }) => {
      const editor = await mountContainerEditor(type, fieldId, {
        [modeId]: mode,
        [fieldId]: collection,
      })

      expect(editor.textField.value).toBe(JSON.stringify(collection))
      const snapshot = readWorkflowSnapshot(editor.doc)
      expect(snapshot.blocks['container-1'].subBlocks[fieldId].value).toEqual(collection)
      expect(
        type === 'loop'
          ? snapshot.loops['container-1'].forEachItems
          : snapshot.parallels['container-1'].distribution
      ).toEqual(collection)

      const replacement = { primary: 'MSFT', secondary: 'GOOG' }
      await act(async () => editor.mutations.setSubBlockValue('container-1', fieldId, replacement))

      expect(editor.textField.value).toBe(JSON.stringify(replacement))
      const state = readWorkflowSnapshot(editor.doc)
      expect(state.blocks['container-1'].subBlocks[fieldId].value).toEqual(replacement)
      expect(
        type === 'loop'
          ? state.loops['container-1'].forEachItems
          : state.parallels['container-1'].distribution
      ).toEqual(replacement)
    }
  )

  it.each([
    { type: 'loop' as const, fieldId: 'iterations', mapKey: 'loops' },
    { type: 'parallel' as const, fieldId: 'count', mapKey: 'parallels' },
  ])(
    'updates $type counts and derived execution state in one undoable transaction',
    async ({ type, fieldId, mapKey }) => {
      const editor = await mountContainerEditor(type)
      const undoManager = new Y.UndoManager(
        [editor.workflowMap, readWorkflowSubBlockFieldsMap(editor.doc)],
        {
          trackedOrigins: createYjsUndoTrackedOrigins(),
        }
      )
      const changes = vi.fn(() => {
        const state = readWorkflowSnapshot(editor.doc)
        expect(state.blocks['container-1'].subBlocks[fieldId].value).toBe(9)
        expect(state).toMatchObject({ [mapKey]: { 'container-1': { [fieldId]: 9 } } })
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
      expect(readWorkflowSnapshot(editor.doc)).toMatchObject({
        [mapKey]: { 'container-1': { [fieldId]: 5 } },
      })
      undoManager.destroy()
    }
  )

  it('derives batch edits from live shared text and preserves inactive container values', async () => {
    const editor = await mountContainerEditor('loop')
    const sharedText = new Y.Text('old condition')
    await act(async () => {
      readWorkflowSubBlockFieldsMap(editor.doc)
        .get('container-1')!
        .set('whileCondition', sharedText)
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

  it('supports custom origins when updating block positions', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    setWorkflowState(
      doc,
      createWorkflowSnapshot({
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'script',
            name: 'Script',
            enabled: true,
            position: { x: 10, y: 20 },
            subBlocks: {},
            outputs: {},
          },
        },
      })
    )

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
    setWorkflowState(
      doc,
      createWorkflowSnapshot({
        blocks: {
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
        },
      })
    )

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
    setWorkflowState(
      doc,
      createWorkflowSnapshot({
        blocks: {
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
        },
      })
    )

    const sharedText = new Y.Text()
    sharedText.insert(0, 'return <myblock.output>')
    readWorkflowSubBlockFieldsMap(doc).get('block-2')!.set('code', sharedText)

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

    const blocks = readWorkflowSnapshot(doc).blocks
    expect(blocks['block-1']?.name).toBe('Human Friendly Name')
    expect(blocks['block-2']?.subBlocks?.prompt?.value).toBe(
      'Use <humanfriendlyname.result> and <humanfriendlyname>'
    )
    expect(blocks['block-2']?.subBlocks?.code?.value).toBe('return <humanfriendlyname.output>')
    expect(sharedText.toString()).toBe('return <humanfriendlyname.output>')
  })

  it('clears parent-specific data when detaching a block from a container', async () => {
    const doc = new Y.Doc()
    setWorkflowState(
      doc,
      createWorkflowSnapshot({
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'script',
            name: 'Script 1',
            enabled: true,
            position: { x: 10, y: 20 },
            subBlocks: {},
            outputs: {},
            locked: true,
            data: {
              parentId: 'loop-1',
              extent: 'parent',
              width: 350,
              height: 180,
            },
          },
        },
      })
    )

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

    expect(readWorkflowSnapshot(doc).blocks['block-1']).toMatchObject({ data: {}, locked: true })
  })
})

describe('useWorkflowField', () => {
  it('initializes populated dynamic text before concurrent editing and preserves its identity', async () => {
    vi.resetModules()
    const { AgentBlock } = await import('@/blocks/blocks/agent')
    const fields = await import('./workflow-session')
    const clients = [new Y.Doc(), new Y.Doc()]
    const fieldId = 'tools-tool-0-query'
    fields.setWorkflowState(
      clients[0],
      createWorkflowSnapshot({
        blocks: {
          agent: {
            id: 'agent',
            type: AgentBlock.type,
            name: AgentBlock.name,
            enabled: true,
            position: { x: 0, y: 0 },
            outputs: {},
            subBlocks: { [fieldId]: { id: fieldId, type: 'code', value: 'SELECT 1' } },
          },
        },
      })
    )
    Y.applyUpdate(clients[1], Y.encodeStateAsUpdate(clients[0]))
    const session = {
      doc: clients[0],
      transactWorkflow: (fn: (doc: Y.Doc) => void, origin?: string) =>
        session.doc.transact(() => fn(session.doc), origin),
    }
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))
    const { useWorkflowField } = await import('./use-workflow-doc')
    let field!: ReturnType<typeof useWorkflowField>
    function Harness() {
      field = useWorkflowField('agent', fieldId)
      return null
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const texts: Y.Text[] = []
    for (const [index, client] of clients.entries()) {
      session.doc = client
      await act(async () => root?.render(React.createElement(Harness, { key: index })))
      expect(field.value).toBe('SELECT 1')
      expect(field.yText).toBeInstanceOf(Y.Text)
      texts.push(field.yText!)
      await act(async () => root?.render(React.createElement(Harness, { key: `remount-${index}` })))
      expect(field.yText).toBe(texts[index])
      if (index === 0) Y.applyUpdate(clients[1], Y.encodeStateAsUpdate(client))
    }
    await act(async () => {
      texts[0].insert(0, '-- prefix\n')
      texts[1].insert(texts[1].length, '; -- suffix')
      Y.applyUpdate(clients[0], Y.encodeStateAsUpdate(clients[1]))
      Y.applyUpdate(clients[1], Y.encodeStateAsUpdate(clients[0]))
    })
    for (const client of clients) {
      expect(extractPersistedStateFromDoc(client).blocks.agent.subBlocks[fieldId].value).toBe(
        '-- prefix\nSELECT 1; -- suffix'
      )
    }
    await act(async () => root?.render(null))
    for (const client of clients) client.destroy()
  })

  it('keeps provider and synthetic field edits undoable through removal and clear', async () => {
    vi.resetModules()
    const fields = await import('./workflow-session')
    const doc = new Y.Doc()
    fields.setWorkflowState(
      doc,
      createWorkflowSnapshot({
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'tts',
            name: 'TTS',
            enabled: true,
            position: { x: 0, y: 0 },
            outputs: {},
            subBlocks: {
              provider: { id: 'provider', type: 'dropdown', value: 'cartesia' },
              voice: { id: 'voice', type: 'short-input', value: 'alloy' },
              tool_code: { id: 'tool_code', type: 'code', value: 'return 1' },
            },
          },
        },
      })
    )
    const session = {
      doc,
      transactWorkflow: (fn: (doc: Y.Doc) => void, origin?: string) =>
        doc.transact(() => fn(doc), origin),
    }
    vi.doMock('@/lib/yjs/workflow-session-host', () => ({
      useOptionalWorkflowSession: () => session,
      useWorkflowSession: () => session,
    }))
    const { useSubBlockValue, useWorkflowField, useWorkflowMutations } = await import(
      './use-workflow-doc'
    )
    const undo = new Y.UndoManager(
      [fields.readWorkflowMap(doc), fields.readWorkflowSubBlockFieldsMap(doc)],
      { trackedOrigins: createYjsUndoTrackedOrigins(), captureTimeout: 0 }
    )
    let field!: ReturnType<typeof useWorkflowField>
    let mutations!: ReturnType<typeof useWorkflowMutations>
    function VoiceEditor() {
      useWorkflowField('block-1', 'voice')
      return null
    }
    function Harness() {
      const provider = useSubBlockValue('block-1', 'provider')
      field = useWorkflowField('block-1', 'tool_code', 'return 1')
      mutations = useWorkflowMutations()
      return provider === 'cartesia' ? React.createElement(VoiceEditor) : null
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root?.render(React.createElement(Harness)))
    const sharedText = field.yText
    expect(sharedText).toBeInstanceOf(Y.Text)
    await act(async () => mutations.setSubBlockValue('block-1', 'provider', 'openai'))
    await act(async () => mutations.setSubBlockValue('block-1', 'voice', 'echo'))
    await act(async () => mutations.setSubBlockValue('block-1', 'provider', 'cartesia'))

    for (const [operation, provider, voice] of [
      ['undo', 'openai', 'echo'],
      ['undo', 'openai', 'alloy'],
      ['undo', 'cartesia', 'alloy'],
      ['redo', 'openai', 'alloy'],
      ['redo', 'openai', 'echo'],
      ['redo', 'cartesia', 'echo'],
    ] as const) {
      await act(async () => undo[operation]())
      expect(fields.readWorkflowSubBlockFieldValue(doc, 'block-1', 'provider')).toBe(provider)
      expect(fields.readWorkflowSubBlockFieldValue(doc, 'block-1', 'voice')).toBe(voice)
      expect(fields.readWorkflowTextField(doc, 'block-1', 'voice')).toBeNull()
    }
    undo.clear()
    expect(field.yText).toBe(sharedText)
    await act(async () => field.setValue('return 2'))
    expect(field.yText).toBe(sharedText)
    expect(field.value).toBe('return 2')
    await act(async () => undo.undo())
    expect(field.value).toBe('return 1')
    expect(field.yText).toBe(sharedText)
    await act(async () => undo.redo())
    expect(field.yText).toBe(sharedText)
    await act(async () => field.setValue('return 3'))
    expect(field.value).toBe('return 3')
    expect(field.yText).toBe(sharedText)

    await act(async () => mutations.removeBlock('block-1'))
    expect(readWorkflowSubBlockFieldsMap(doc).size).toBe(0)
    await act(async () => mutations.addBlock('block-1', 'function', 'Script', { x: 0, y: 0 }))
    expect(field.value).toBe('return 1')
    await act(async () => mutations.clear())
    expect(readWorkflowSubBlockFieldsMap(doc).size).toBe(0)
    expect(readWorkflowSnapshot(doc).blocks).toEqual({})
    undo.destroy()
  })
})
