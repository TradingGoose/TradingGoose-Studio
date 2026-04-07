/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as Y from 'yjs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  bindWorkflowTextObserver,
  getLoopCollectionDataUpdate,
  getParallelCollectionDataUpdate,
} from './use-workflow-doc'
import { createYjsUndoTrackedOrigins, YJS_ORIGINS } from './transaction-origins'
import { createWorkflowTextFieldKey, getWorkflowTextFieldsMap } from './workflow-session'

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
  vi.unmock('@/lib/yjs/workflow-session-host')
})

afterAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

describe('workflow mutation helpers', () => {
  it('writes while/doWhile collection edits to whileCondition', () => {
    expect(getLoopCollectionDataUpdate('while', 'status.ready')).toEqual({
      whileCondition: 'status.ready',
    })
    expect(getLoopCollectionDataUpdate('doWhile', 'status.ready')).toEqual({
      whileCondition: 'status.ready',
    })
  })

  it('writes collection-mode parallel edits to collection', () => {
    expect(getParallelCollectionDataUpdate('items')).toEqual({
      collection: 'items',
    })
  })

  it('binds and cleans up existing Y.Text observers without double-unobserve errors', () => {
    const doc = new Y.Doc()
    const textFields = getWorkflowTextFieldsMap(doc)
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
    const textFields = getWorkflowTextFieldsMap(doc)
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

  it('preserves the typed block name unless another block already uses the normalized prefix', async () => {
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
        name: 'myblock 1',
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
      mutations?.updateBlockName('block-1', 'My Block')
    })

    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.name).toBe('My Block 2')

    await act(async () => {
      mutations?.updateBlockName('block-1', 'Human Friendly Name')
    })

    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.name).toBe(
      'Human Friendly Name'
    )
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
    getWorkflowTextFieldsMap(doc).set(textFieldKey, sharedText)

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
    expect(blocks['block-2']?.subBlocks?.code?.value).toBe(
      'return <humanfriendlyname.output>'
    )
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
      const textFields = getWorkflowTextFieldsMap(doc)
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

      const session = { doc }
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
