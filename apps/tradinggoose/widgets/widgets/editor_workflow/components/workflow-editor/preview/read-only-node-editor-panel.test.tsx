import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReadOnlyNodeEditorPanel } from './read-only-node-editor-panel'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const { useLocaleMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'zh-CN'),
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

function createWorkflowState(): WorkflowState {
  return {
    blocks: {
      agent_1: {
        id: 'agent_1',
        type: 'agent',
        name: 'Agent One',
        position: { x: 0, y: 0 },
        subBlocks: {
          prompt: { id: 'prompt', type: 'long-input', value: 'hello' } as any,
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

    expect(markup).toContain('选择一个块以查看其预览详情。')
  })

  it('renders missing-node state when selected id is not present', () => {
    const markup = renderToStaticMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'missing',
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('未找到节点')
    expect(markup).toContain('已不可用')
  })

  it('renders inspector header and resolved read-only panel for selected node', () => {
    const markup = renderToStaticMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'agent_1',
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('预览检查器')
    expect(markup).toContain('Agent One')
    expect(markup).toContain('prompt')
    expect(markup).toContain('hello')
  })
})
