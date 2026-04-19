/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAdaptPreviewPayloadToCanvas = vi.fn()
let lastReactFlowProps: Record<string, any> | null = null

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-payload-adapter',
  () => ({
    adaptPreviewPayloadToCanvas: (...args: any[]) => mockAdaptPreviewPayloadToCanvas(...args),
  })
)

vi.mock('reactflow', () => {
  return {
    __esModule: true,
    default: (props: any) => {
      lastReactFlowProps = props
      return <div data-testid='reactflow'>{props.children}</div>
    },
    Background: () => <div data-testid='background' />,
    ConnectionLineType: {
      Bezier: 'bezier',
    },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useReactFlow: () => ({
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
    }),
    useStore: () => 1,
  }
})

vi.mock('reactflow/dist/style.css', () => ({}))
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))
vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-edge/workflow-edge',
  () => ({
    WorkflowEdge: () => null,
  })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-node',
  () => ({
    PreviewNode: () => null,
  })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-subflow',
  () => ({
    PreviewSubflow: () => null,
  })
)

import { WorkflowPreviewCanvas } from './workflow-preview-canvas'

describe('WorkflowPreviewCanvas', () => {
  let container: HTMLDivElement
  let root: Root

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    lastReactFlowProps = null
    mockAdaptPreviewPayloadToCanvas.mockReset()
    mockAdaptPreviewPayloadToCanvas.mockReturnValue({
      nodes: [
        {
          id: 'node-1',
          type: 'previewNode',
          position: { x: 0, y: 0 },
          data: {},
        },
      ],
      edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', type: 'workflowEdge' }],
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('enables node dragging with local default nodes and edges', async () => {
    await act(async () => {
      root.render(
        <WorkflowPreviewCanvas
          workflowKey='demo-a'
          workflowState={{ blocks: {}, edges: [], loops: {}, parallels: {} } as any}
        />
      )
    })

    expect(lastReactFlowProps?.nodesDraggable).toBe(true)
    expect(lastReactFlowProps?.defaultNodes).toEqual([
      expect.objectContaining({
        id: 'node-1',
        position: { x: 0, y: 0 },
      }),
    ])
    expect(lastReactFlowProps?.defaultEdges).toEqual([
      expect.objectContaining({
        id: 'edge-1',
        type: 'workflowEdge',
      }),
    ])
  })

  it('reboots the local preview state when the demo key changes', async () => {
    await act(async () => {
      root.render(
        <WorkflowPreviewCanvas
          workflowKey='demo-a'
          workflowState={{ blocks: {}, edges: [], loops: {}, parallels: {} } as any}
        />
      )
    })

    mockAdaptPreviewPayloadToCanvas.mockReturnValue({
      nodes: [
        {
          id: 'node-2',
          type: 'previewNode',
          position: { x: 24, y: 36 },
          data: {},
        },
      ],
      edges: [],
    })

    await act(async () => {
      root.render(
        <WorkflowPreviewCanvas
          workflowKey='demo-b'
          workflowState={{ blocks: {}, edges: [], loops: {}, parallels: {} } as any}
        />
      )
    })

    expect(lastReactFlowProps?.defaultNodes).toEqual([
      expect.objectContaining({
        id: 'node-2',
        position: { x: 24, y: 36 },
      }),
    ])
  })
})
