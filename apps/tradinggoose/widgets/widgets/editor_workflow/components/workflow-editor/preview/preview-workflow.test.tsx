import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const mockAdaptPreviewPayloadToCanvas = vi.fn()
const mockReadOnlyNodeEditorPanel = vi.fn((props: any) =>
  createElement('aside', {
    'data-testid': 'inspector',
    'data-selected-node-id': props?.selectedNodeId ?? 'none',
  })
)
let lastReactFlowProps: Record<string, any> | null = null

vi.mock('./preview-payload-adapter', () => ({
  adaptPreviewPayloadToCanvas: (...args: any[]) => mockAdaptPreviewPayloadToCanvas(...args),
}))

vi.mock('./read-only-node-editor-panel', () => ({
  ReadOnlyNodeEditorPanel: (props: any) => mockReadOnlyNodeEditorPanel(props),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}))

vi.mock('reactflow', () => {
  const ReactFlow = (props: any) => {
    lastReactFlowProps = props
    return createElement('div', { 'data-testid': 'reactflow' }, props.children)
  }

  return {
    __esModule: true,
    default: ReactFlow,
    ReactFlowProvider: ({ children }: any) =>
      createElement('div', { 'data-testid': 'provider' }, children),
    Background: (props: any) =>
      createElement('div', {
        'data-testid': 'background',
        'data-size': String(props.size),
        'data-gap': String(props.gap),
      }),
    ConnectionLineType: {
      Bezier: 'default',
    },
  }
})

vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('./preview-subflow', () => ({
  PreviewSubflow: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/components/workflow-edge/workflow-edge', () => ({
  WorkflowEdge: () => null,
}))
vi.mock('./preview-node', () => ({
  PreviewNode: () => null,
}))

import { PreviewWorkflow } from './preview-workflow'

function createWorkflowState(): WorkflowState {
  return {
    blocks: {
      agent_1: {
        id: 'agent_1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {} as any,
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

describe('PreviewWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastReactFlowProps = null
    mockAdaptPreviewPayloadToCanvas.mockReturnValue({
      nodes: [{ id: 'agent_1', type: 'previewNode', data: {} }],
      edges: [{ id: 'edge_1', source: 'a', target: 'b' }],
    })
  })

  it('adapts payload and renders canonical preview canvas with inspector by default', () => {
    const workflowState = createWorkflowState()
    const markup = renderToStaticMarkup(createElement(PreviewWorkflow, { workflowState }))

    expect(markup).toContain('data-testid="provider"')
    expect(mockAdaptPreviewPayloadToCanvas).toHaveBeenCalledTimes(1)
    expect(mockAdaptPreviewPayloadToCanvas).toHaveBeenCalledWith(workflowState)
    expect(lastReactFlowProps?.nodes).toEqual([{ id: 'agent_1', type: 'previewNode', data: {} }])
    expect(lastReactFlowProps?.edges).toEqual([{ id: 'edge_1', source: 'a', target: 'b' }])
    expect(lastReactFlowProps?.connectionLineType).toBe('default')
    expect(lastReactFlowProps?.fitViewOptions).toEqual({ padding: 0.25 })
    expect(lastReactFlowProps?.defaultViewport).toEqual({ x: 0, y: 0, zoom: 0.8 })

    expect(mockReadOnlyNodeEditorPanel).toHaveBeenCalledTimes(1)
    expect(mockReadOnlyNodeEditorPanel).toHaveBeenCalledWith({
      selectedNodeId: null,
      workflowState,
    })
  })

  it('supports showInspector=false and honors canvas options', () => {
    const markup = renderToStaticMarkup(
      createElement(PreviewWorkflow, {
        workflowState: createWorkflowState(),
        showInspector: false,
        isPannable: true,
        defaultZoom: 1.1,
        fitPadding: 0.4,
        className: 'preview-shell',
        framed: false,
      })
    )

    expect(lastReactFlowProps?.panOnDrag).toBe(true)
    expect(lastReactFlowProps?.fitViewOptions).toEqual({ padding: 0.4 })
    expect(lastReactFlowProps?.defaultViewport).toEqual({ x: 0, y: 0, zoom: 1.1 })
    expect(mockReadOnlyNodeEditorPanel).not.toHaveBeenCalled()
    expect(markup).toContain('class="flex h-full w-full preview-shell"')
  })
})
