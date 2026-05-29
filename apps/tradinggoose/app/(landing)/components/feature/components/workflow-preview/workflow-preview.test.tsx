/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy, getScopedPublicMessages } from '@/i18n/public-copy'

vi.mock('@xyflow/react', () => ({
  __esModule: true,
  ReactFlow: ({ defaultNodes, nodeTypes, children }: any) => (
    <div data-testid='reactflow'>
      {defaultNodes?.map((node: any) => {
        const NodeComponent = nodeTypes?.[node.type]
        if (!NodeComponent) return null

        return (
          <NodeComponent
            key={node.id}
            id={node.id}
            type={node.type}
            data={node.data}
            selected={false}
            dragging={false}
            zIndex={0}
            isConnectable={false}
            xPos={node.position?.x ?? 0}
            yPos={node.position?.y ?? 0}
            positionAbsoluteX={node.position?.x ?? 0}
            positionAbsoluteY={node.position?.y ?? 0}
          />
        )
      })}
      {children}
    </div>
  ),
  Background: () => null,
  ConnectionLineType: {
    Bezier: 'bezier',
  },
  Handle: () => null,
  Position: {
    Left: 'left',
    Top: 'top',
    Bottom: 'bottom',
    Right: 'right',
  },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useReactFlow: () => ({
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  }),
  useStore: () => 1,
}))

vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/listing-selector/listing/row', () => ({
  getListingDisplaySymbol: (listing: { base?: string | null; name?: string | null }) =>
    listing?.base || listing?.name || 'Listing',
  ListingDisplayRow: ({ listing }: { listing?: { base?: string | null; name?: string | null } }) => (
    <span>{listing?.base || listing?.name || 'Listing'}</span>
  ),
}))
vi.mock('@/components/listing-selector/selector/resolve-request', () => ({
  requestListingResolution: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}))
vi.mock('@/widgets/widgets/editor_workflow/components/workflow-edge/workflow-edge', () => ({
  WorkflowEdge: () => null,
}))
vi.mock('../market-preview/landing-widget-shell', () => ({
  LandingWidgetShell: ({
    headerCenter,
    children,
  }: {
    headerCenter?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div data-testid='landing-widget-shell'>
      <div>{headerCenter}</div>
      <div>{children}</div>
    </div>
  ),
}))
vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderControlClassName: () => '',
  widgetHeaderMenuContentClassName: '',
  widgetHeaderMenuItemClassName: '',
  widgetHeaderMenuTextClassName: '',
}))

import {
  buildTradingAgentWorkflowDemos,
  type WorkflowPreviewDemo,
} from './workflow-preview-demos'
import { WorkflowPreview } from './workflow-preview'

describe('WorkflowPreview', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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

  it('renders localized workflow preview nodes from landing-only provider messages', async () => {
    const copy = getPublicCopy('en')
    const demos = buildTradingAgentWorkflowDemos('en', copy.landing.preview.workflow.demoCopy)
    const investmentDebateDemo = demos.find((demo) => demo.id === 'investment-debate')

    expect(investmentDebateDemo).toBeDefined()

    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale='en'
          messages={getScopedPublicMessages('en', ['landing'] as const)}
        >
          <WorkflowPreview demos={[investmentDebateDemo!]} />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(investmentDebateDemo!.name)
    expect(container.textContent).toContain('Bull vs Bear Debate')
    expect(container.textContent).toContain(copy.workspace.widgets.workflowEditor.start)
    expect(container.textContent).toContain(copy.workspace.widgets.workflowLabels.error)
  })

  it('builds presentation-only landing workflow preview payloads', () => {
    const copy = getPublicCopy('en')
    const demos = buildTradingAgentWorkflowDemos('en', copy.landing.preview.workflow.demoCopy)

    for (const demo of demos) {
      expect(demo).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          color: expect.any(String),
          previewPayload: expect.objectContaining({
            nodes: expect.any(Array),
            edges: expect.any(Array),
          }),
        })
      )

      for (const node of demo.previewPayload.nodes) {
        expect(node.data).not.toHaveProperty('config')
        expect(node.data).not.toHaveProperty('blockState')
        expect(node.data).not.toHaveProperty('subBlockValues')

        if (node.type === 'previewNode') {
          expect(node.data).toEqual(
            expect.objectContaining({
              title: expect.any(String),
              summaryRows: expect.any(Array),
              objectItemLabel: expect.any(String),
              readOnly: true,
              isPreview: true,
            })
          )
        }

        if (node.type === 'subflowNode') {
          expect(node.data).toEqual(
            expect.objectContaining({
              title: expect.any(String),
              startLabel: expect.any(String),
              endLabel: expect.any(String),
              isPreview: true,
            })
          )
        }
      }
    }
  })

  it('renders the localized object fallback label for precomputed summary rows', async () => {
    const copy = getPublicCopy('es')
    const demo: WorkflowPreviewDemo = {
      id: 'localized-object-label',
      name: 'Resumen',
      color: '#0ea5e9',
      previewPayload: {
        nodes: [
          {
            id: 'trigger',
            type: 'previewNode',
            position: { x: 0, y: 0 },
            data: {
              type: 'indicator_trigger',
              name: 'trigger',
              readOnly: true,
              isPreview: true,
              title: 'Monitor',
              objectItemLabel: copy.workspace.widgets.workflowEditor.summary.objectItem,
              summaryRows: [
                {
                  id: 'assets',
                  kind: 'listing',
                  title: 'Activos',
                  value: '',
                  rawValue: [{ foo: 'bar' }],
                },
              ],
              enabled: true,
              horizontalHandles: false,
            },
          },
        ],
        edges: [],
      },
    }

    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale='es'
          messages={getScopedPublicMessages('es', ['landing'] as const)}
        >
          <WorkflowPreview demos={[demo]} />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(copy.workspace.widgets.workflowEditor.summary.objectItem)
  })
})
