import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { ReadOnlyNodeEditorPanel } from './read-only-node-editor-panel'

function createWorkflowState(): WorkflowState {
  return {
    blocks: {
      agent_1: {
        id: 'agent_1',
        type: 'agent',
        name: 'Agent One',
        position: { x: 0, y: 0 },
        subBlocks: {
          responseFormat: { id: 'responseFormat', type: 'code', value: 'hello' } as any,
        },
        outputs: {} as any,
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

describe('ReadOnlyNodeEditorPanel', () => {
  it('renders empty selection state when no node is selected', () => {
    const markup = renderToStaticMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: null,
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('Select a block to view its preview details.')
  })

  it('renders missing-node state when selected id is not present', () => {
    const markup = renderToStaticMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'missing',
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('Node not found')
    expect(markup).toContain('no longer available')
  })

  it('renders inspector header and canonical summary rows for selected node', () => {
    const markup = renderToStaticMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'agent_1',
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('Preview Inspector')
    expect(markup).toContain('Agent One')
    expect(markup).toContain('responseFormat')
    expect(markup).toContain('hello')
  })
})
