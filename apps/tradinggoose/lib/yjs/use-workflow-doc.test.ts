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
import { createWorkflowTextFieldKey, getWorkflowTextFieldsMap } from './workflow-session'

let container: HTMLDivElement | null = null
let root: Root | null = null
const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

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
