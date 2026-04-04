import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import {
  createWorkflowTextFieldKey,
  getWorkflowSnapshot,
  getWorkflowTextFieldsMap,
  setWorkflowState,
} from './workflow-session'

describe('workflow session text fields', () => {
  it('materializes Y.Text-backed subblock values into workflow snapshots', () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    const textFields = getWorkflowTextFieldsMap(doc)

    workflowMap.set('blocks', {
      'block-1': {
        id: 'block-1',
        type: 'script',
        name: 'Script',
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
    workflowMap.set('loops', {})
    workflowMap.set('parallels', {})

    const sharedText = new Y.Text()
    sharedText.insert(0, 'live-ytext-value')
    textFields.set(createWorkflowTextFieldKey('block-1', 'code'), sharedText)

    expect(getWorkflowSnapshot(doc).blocks['block-1']?.subBlocks?.code?.value).toBe('live-ytext-value')
  })

  it('keeps existing Y.Text entries in sync when workflow state is replaced', () => {
    const doc = new Y.Doc()
    const textFields = getWorkflowTextFieldsMap(doc)

    const staleText = new Y.Text()
    staleText.insert(0, 'stale')
    textFields.set(createWorkflowTextFieldKey('block-1', 'code'), staleText)

    setWorkflowState(doc, {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'script',
          name: 'Script',
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
    expect((textFields.get(createWorkflowTextFieldKey('block-1', 'code')) as Y.Text).toString()).toBe(
      'fresh'
    )
    expect(getWorkflowSnapshot(doc).blocks['block-1']?.subBlocks?.code?.value).toBe('fresh')
  })
})
