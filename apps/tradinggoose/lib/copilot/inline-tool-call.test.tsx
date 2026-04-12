/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineToolCall } from './inline-tool-call'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockUseCopilotStoreState = {
  accessLevel: 'limited' as const,
  executeCopilotToolCall: vi.fn(),
  executeIntegrationTool: vi.fn(),
  skipCopilotToolCall: vi.fn(),
  skipIntegrationTool: vi.fn(),
  toolCallsById: {},
}

const mockEntitySession = {
  doc: null as any,
  provider: null,
  awareness: null,
  descriptor: null as any,
  runtime: null,
  undoManager: null,
  canUndo: false,
  canRedo: false,
  undo: vi.fn(),
  redo: vi.fn(),
  isSynced: false,
  isLoading: false,
  error: null,
}

const mockGetEntityFields = vi.fn()

vi.mock('react-google-drive-picker', () => ({
  default: () => [vi.fn()],
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: (selector?: (state: any) => unknown) =>
    selector ? selector(mockUseCopilotStoreState) : mockUseCopilotStoreState,
}))

vi.mock('@/stores/copilot/tool-registry', () => ({
  getCopilotToolMetadata: () => undefined,
  getToolInterruptDisplays: () => undefined,
  isCopilotTool: () => true,
}))

vi.mock('@/lib/copilot/review-sessions/entity-session-host', () => ({
  useEntitySession: () => mockEntitySession,
}))

vi.mock('@/lib/yjs/entity-session', () => ({
  getEntityFields: (...args: any[]) => mockGetEntityFields(...args),
}))

vi.mock('@/lib/copilot/tools/client/manager', () => ({
  getClientTool: () => undefined,
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-editor/preview/preview-workflow',
  () => ({
    PreviewWorkflow: ({ workflowState }: { workflowState: Record<string, any> }) => (
      <div data-testid='workflow-preview'>{Object.keys(workflowState.blocks || {}).join(',')}</div>
    ),
  })
)

describe('InlineToolCall', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockEntitySession.doc = null
    mockEntitySession.descriptor = null
    mockGetEntityFields.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders a workflow review preview card for staged edit_workflow results', async () => {
    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-review-preview',
            name: 'edit_workflow',
            state: ClientToolCallState.review,
            result: {
              workflowState: {
                blocks: {
                  'trigger-1': {
                    id: 'trigger-1',
                    type: 'manual_trigger',
                    name: 'Trigger',
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
              preview: {
                blockDiff: {
                  added: [],
                  removed: [],
                  updated: ['trigger-1'],
                },
                edgeDiff: {
                  added: [],
                  removed: [],
                },
                warnings: ['Added block trigger-1 has no outgoing edges.'],
              },
            },
          }}
        />
      )
    })

    expect(container.textContent).toContain('Proposed Changes')
    expect(container.textContent).toContain('Update trigger-1')
    expect(container.textContent).toContain('Added block trigger-1 has no outgoing edges.')
    expect(container.querySelector('[data-testid="workflow-preview"]')?.textContent).toContain(
      'trigger-1'
    )
  })

  it('does not render a workflow preview card for non-review workflow tool states', async () => {
    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-applied-edit',
            name: 'edit_workflow',
            state: ClientToolCallState.success,
            result: {
              workflowState: {
                blocks: {
                  'trigger-1': {
                    id: 'trigger-1',
                    type: 'manual_trigger',
                    name: 'Trigger',
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
              preview: {
                blockDiff: {
                  added: [],
                  removed: [],
                  updated: ['trigger-1'],
                },
                edgeDiff: {
                  added: [],
                  removed: [],
                },
                warnings: ['Added block trigger-1 has no outgoing edges.'],
              },
            },
          }}
        />
      )
    })

    expect(container.textContent).not.toContain('Proposed Changes')
    expect(container.querySelector('[data-testid="workflow-preview"]')).toBeNull()
  })

  it('does not render a workflow preview card after edit_workflow is accepted', async () => {
    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-applied-edit',
            name: 'edit_workflow',
            state: ClientToolCallState.success,
            result: {
              workflowState: {
                blocks: {
                  'trigger-1': {
                    id: 'trigger-1',
                    type: 'manual_trigger',
                    name: 'Trigger',
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }}
        />
      )
    })

    expect(container.textContent).not.toContain('Proposed Changes')
    expect(container.querySelector('[data-testid="workflow-preview"]')).toBeNull()
  })

  it('renders entity diffs in the copilot widget for pending entity edits', async () => {
    mockEntitySession.doc = { id: 'entity-doc' }
    mockEntitySession.descriptor = {
      entityKind: 'skill',
    }
    mockGetEntityFields.mockReturnValue({
      name: 'Original skill',
      description: 'Original description',
      content: 'Original instructions',
    })

    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-skill-review',
            name: 'edit_skill',
            state: ClientToolCallState.pending,
            params: {
              entityDocument: JSON.stringify({
                name: 'Updated skill',
                description: 'Original description',
                content: 'Updated instructions',
              }),
            },
          }}
        />
      )
    })

    expect(container.textContent).toContain('Proposed Skill Changes')
    expect(container.textContent).toContain('Original skill')
    expect(container.textContent).toContain('Updated skill')
    expect(container.textContent).toContain('Original instructions')
    expect(container.textContent).toContain('Updated instructions')
  })
})
