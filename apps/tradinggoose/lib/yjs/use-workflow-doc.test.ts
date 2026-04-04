import * as Y from 'yjs'
import { describe, expect, it, vi } from 'vitest'
import {
  bindWorkflowTextObserver,
  getLoopCollectionDataUpdate,
  getParallelCollectionDataUpdate,
} from './use-workflow-doc'
import { createWorkflowTextFieldKey, getWorkflowTextFieldsMap } from './workflow-session'

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
