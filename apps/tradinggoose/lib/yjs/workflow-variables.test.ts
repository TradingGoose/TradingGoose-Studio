/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  createWorkflowTextFieldKey,
  getVariablesSnapshot,
  getWorkflowSnapshot,
  getWorkflowTextFieldsMap,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import {
  addWorkflowVariable,
  deleteWorkflowVariable,
  duplicateWorkflowVariable,
  getWorkflowVariables,
  updateWorkflowVariable,
} from '@/lib/yjs/workflow-variables'

function createDoc() {
  const doc = new Y.Doc()
  setWorkflowState(
    doc,
    {
      blocks: {
        blockA: {
          id: 'blockA',
          type: 'agent',
          name: 'Block A',
          position: { x: 0, y: 0 },
          subBlocks: {
            prompt: {
              id: 'prompt',
              type: 'long-input',
              value: 'Use <variable.foovalue> in this prompt',
            },
          },
          outputs: {},
          enabled: true,
          locked: false,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          triggerMode: false,
          height: 0,
          data: {},
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    },
    'test'
  )
  return doc
}

describe('workflow variable Yjs mutations', () => {
  it('adds variables with generated unique names and coerced plain-text types', () => {
    const doc = createDoc()

    addWorkflowVariable(
      doc,
      { workflowId: 'wf-1', name: '', type: 'string', value: '' },
      'var-1',
      'test'
    )
    addWorkflowVariable(
      doc,
      { workflowId: 'wf-1', name: 'variable1', type: 'plain', value: '' },
      'var-2',
      'test'
    )

    expect(getVariablesSnapshot(doc)).toMatchObject({
      'var-1': {
        id: 'var-1',
        workflowId: 'wf-1',
        name: 'variable1',
        type: 'plain',
        value: '',
      },
      'var-2': {
        id: 'var-2',
        workflowId: 'wf-1',
        name: 'variable2',
        type: 'plain',
        value: '',
      },
    })
  })

  it('updates variable names, rewrites references, and recomputes validation', () => {
    const doc = createDoc()

    addWorkflowVariable(
      doc,
      { workflowId: 'wf-1', name: 'Foo Value', type: 'plain', value: 'hello' },
      'var-1',
      'test'
    )

    expect(
      updateWorkflowVariable(
        doc,
        'var-1',
        { name: 'Bar Value', type: 'boolean', value: 'not-bool' },
        'test'
      )
    ).toBe(true)

    expect(getVariablesSnapshot(doc)['var-1']).toMatchObject({
      id: 'var-1',
      name: 'Bar Value',
      type: 'boolean',
      value: 'not-bool',
      validationError: 'Expected "true" or "false"',
    })
    expect(doc.getMap('workflow').get('blocks')).toMatchObject({
      blockA: {
        subBlocks: {
          prompt: {
            value: 'Use <variable.barvalue> in this prompt',
          },
        },
      },
    })
  })

  it('rewrites references inside text-backed workflow subblocks when renaming', () => {
    const doc = createDoc()

    addWorkflowVariable(
      doc,
      { workflowId: 'wf-1', name: 'Foo Value', type: 'plain', value: 'hello' },
      'var-1',
      'test'
    )

    const textFieldKey = createWorkflowTextFieldKey('blockA', 'prompt')
    const sharedText = new Y.Text()
    sharedText.insert(0, 'Use <variable.foovalue> in this prompt')
    getWorkflowTextFieldsMap(doc).set(textFieldKey, sharedText)

    expect(updateWorkflowVariable(doc, 'var-1', { name: 'Bar Value' }, 'test')).toBe(true)

    expect(sharedText.toString()).toBe('Use <variable.barvalue> in this prompt')
    expect(getWorkflowTextFieldsMap(doc).get(textFieldKey)).toBe(sharedText)
    expect(doc.getMap('workflow').get('blocks')).toMatchObject({
      blockA: {
        subBlocks: {
          prompt: {
            value: 'Use <variable.barvalue> in this prompt',
          },
        },
      },
    })
    expect(getWorkflowSnapshot(doc).blocks.blockA.subBlocks.prompt.value).toBe(
      'Use <variable.barvalue> in this prompt'
    )
  })

  it('does not rewrite references during transient blank-name edits', () => {
    const doc = createDoc()

    addWorkflowVariable(
      doc,
      { workflowId: 'wf-1', name: 'Foo Value', type: 'plain', value: 'hello' },
      'var-1',
      'test'
    )

    expect(updateWorkflowVariable(doc, 'var-1', { name: '' }, 'test')).toBe(true)
    expect(getVariablesSnapshot(doc)['var-1']).toMatchObject({
      id: 'var-1',
      name: '',
    })
    expect(doc.getMap('workflow').get('blocks')).toMatchObject({
      blockA: {
        subBlocks: {
          prompt: {
            value: 'Use <variable.foovalue> in this prompt',
          },
        },
      },
    })
  })

  it('duplicates and deletes variables through the Yjs map', () => {
    const doc = createDoc()

    addWorkflowVariable(
      doc,
      { workflowId: 'wf-1', name: 'apiKey', type: 'plain', value: 'secret' },
      'var-1',
      'test'
    )

    const duplicateId = duplicateWorkflowVariable(doc, 'var-1', 'var-2', 'test')
    expect(duplicateId).toBe('var-2')
    expect(getWorkflowVariables(doc, 'wf-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'var-1', name: 'apiKey' }),
        expect.objectContaining({ id: 'var-2', name: 'apiKey (copy)', value: 'secret' }),
      ])
    )

    expect(deleteWorkflowVariable(doc, 'var-1', 'test')).toBe(true)
    expect(getVariablesSnapshot(doc)).toEqual({
      'var-2': {
        id: 'var-2',
        workflowId: 'wf-1',
        name: 'apiKey (copy)',
        type: 'plain',
        value: 'secret',
      },
    })
  })
})
