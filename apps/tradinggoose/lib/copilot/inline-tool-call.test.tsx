/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { InlineToolCall } from './inline-tool-call'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockUseCopilotStoreState = {
  accessLevel: 'limited' as 'limited' | 'full',
  executeCopilotToolCall: vi.fn(),
  skipCopilotToolCall: vi.fn(),
  toolCallsById: {},
}

const mockGetToolInterruptDisplays = vi.fn()

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: (selector?: (state: any) => unknown) =>
    selector ? selector(mockUseCopilotStoreState) : mockUseCopilotStoreState,
}))

vi.mock('@/stores/copilot/tool-registry', () => ({
  getCopilotToolMetadata: () => undefined,
  getToolInterruptDisplays: (...args: any[]) => mockGetToolInterruptDisplays(...args),
  isCopilotTool: () => true,
  isGatedTool: (name: string) => name !== 'edit_workflow' && name !== 'edit_workflow_block',
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
    mockGetToolInterruptDisplays.mockReset()
    mockUseCopilotStoreState.executeCopilotToolCall.mockReset()
    mockUseCopilotStoreState.skipCopilotToolCall.mockReset()
    mockUseCopilotStoreState.accessLevel = 'limited'
    mockUseCopilotStoreState.toolCallsById = {}
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
                  'existing-1': {
                    id: 'existing-1',
                    type: 'http_request',
                    name: 'Request',
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
              preview: {
                blockDiff: {
                  added: ['trigger-1'],
                  removed: ['old-1'],
                  updated: ['existing-1'],
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

    expect(container.textContent).toContain('Blocks +1')
    expect(container.textContent).toContain('Blocks -1')
    expect(container.textContent).not.toContain('Proposed Changes')
    expect(container.textContent).not.toContain('Add trigger-1')
    expect(container.textContent).not.toContain('Update existing-1')
    expect(container.textContent).not.toContain('Remove old-1')
    expect(container.textContent).toContain('Added block trigger-1 has no outgoing edges.')
    expect(container.querySelector('[data-testid="workflow-preview"]')?.textContent).toContain(
      'trigger-1'
    )
    expect(container.querySelector('[data-testid="workflow-preview"]')?.textContent).toContain(
      'existing-1'
    )
  })

  it('does not render a workflow preview card for active workflow tool states', async () => {
    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-applied-edit',
            name: 'edit_workflow',
            state: ClientToolCallState.executing,
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

    expect(container.textContent).not.toContain('Blocks +')
    expect(container.textContent).not.toContain('Blocks -')
    expect(container.querySelector('[data-testid="workflow-preview"]')).toBeNull()
  })

  it('renders the workflow preview card after edit_workflow is accepted', async () => {
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

    expect(container.querySelector('[data-testid="workflow-preview"]')?.textContent).toContain(
      'trigger-1'
    )
  })

  it('renders only the workflow review for staged edit_workflow_block results', async () => {
    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-block-review',
            name: 'edit_workflow_block',
            state: ClientToolCallState.review,
            params: {
              workflowId: 'wf-1',
              blockId: 'fn1',
              blockType: 'function',
              name: 'Compute Market Indicators',
              enabled: false,
              subBlocks: {
                code: 'return { rsi: 50 }',
              },
            },
            result: {
              workflowState: {
                blocks: {
                  fn1: {
                    id: 'fn1',
                    type: 'function',
                    name: 'Compute Market Indicators',
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

    expect(container.textContent).not.toContain('Proposed Workflow Block Changes')
    expect(container.textContent).not.toContain('subBlocks.code')
    expect(container.querySelector('[data-testid="workflow-preview"]')?.textContent).toContain(
      'fn1'
    )
  })

  it('shows review controls for already-staged workflow edits in full access', async () => {
    const toolCallId = 'tool-workflow-review'
    mockUseCopilotStoreState.accessLevel = 'full'
    mockGetToolInterruptDisplays.mockReturnValue({
      accept: { text: 'Accept' },
      reject: { text: 'Reject' },
    })
    mockUseCopilotStoreState.toolCallsById = {
      [toolCallId]: {
        id: toolCallId,
        name: 'edit_workflow',
        state: ClientToolCallState.review,
      },
    }

    await act(async () => {
      root.render(<InlineToolCall toolCallId={toolCallId} />)
    })

    expect(container.textContent).not.toContain('Allow')
    expect(container.textContent).toContain('Accept')
    expect(container.textContent).toContain('Reject')
  })

  it('uses interrupt labels for generic gated pending tools', async () => {
    mockGetToolInterruptDisplays.mockReturnValue({
      accept: { text: 'Execute' },
      reject: { text: 'Skip' },
    })

    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-pending-api',
            name: 'make_api_request',
            state: ClientToolCallState.pending,
          }}
        />
      )
    })

    expect(container.textContent).toContain('Execute')
    expect(container.textContent).not.toContain('Allow')
  })

  it('renders entity review diffs with controls for already-staged reviews in full access', async () => {
    mockUseCopilotStoreState.accessLevel = 'full'
    mockGetToolInterruptDisplays.mockReturnValue({
      accept: { text: 'Accept changes' },
      reject: { text: 'Reject changes' },
    })

    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-skill-review',
            name: 'edit_skill',
            state: ClientToolCallState.review,
            result: {
              entityKind: 'skill',
              entityName: 'Updated skill',
              preview: {
                documentDiff: {
                  before: JSON.stringify(
                    {
                      name: 'Original skill',
                      description: 'Original description',
                      content: 'Original instructions',
                    },
                    null,
                    2
                  ),
                  after: JSON.stringify(
                    {
                      name: 'Updated skill',
                      description: 'Original description',
                      content: 'Updated instructions',
                    },
                    null,
                    2
                  ),
                },
              },
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
    expect(container.textContent).toContain('Accept changes')
    expect(container.textContent).toContain('Reject changes')
  })

  it('renders dedicated watchlist review diffs for watchlist mutations', async () => {
    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-watchlist-review',
            name: 'edit_watchlist',
            state: ClientToolCallState.review,
            result: {
              entityKind: 'watchlist',
              entityName: 'Momentum',
              documentFormat: 'tg-watchlist-document-v1',
              preview: {
                documentDiff: {
                  before: JSON.stringify({
                    name: 'Watchlist',
                    settings: {
                      showLogo: true,
                      showTicker: true,
                      showDescription: true,
                    },
                    items: [],
                  }),
                  after: JSON.stringify({
                    name: 'Momentum',
                    settings: {
                      showLogo: true,
                      showTicker: true,
                      showDescription: true,
                    },
                    items: [
                      { type: 'section', label: 'Crypto' },
                      {
                        type: 'listing',
                        listing: {
                          listing_id: '',
                          base_id: 'BTC',
                          quote_id: 'USD',
                          listing_type: 'crypto',
                        },
                      },
                    ],
                  }),
                },
              },
            },
          }}
        />
      )
    })

    expect(container.textContent).toContain('Proposed Watchlist Changes')
    expect(container.textContent).toContain('Momentum')
    expect(container.textContent).toContain('Crypto')
    expect(container.textContent).toContain('BTC')
  })

  it('falls back to generic entity diffs for non-mutation or malformed watchlist reviews', async () => {
    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-watchlist-read-preview',
            name: 'read_watchlist',
            state: ClientToolCallState.review,
            result: {
              entityKind: 'watchlist',
              documentFormat: 'tg-watchlist-document-v1',
              preview: {
                documentDiff: {
                  before: JSON.stringify({
                    name: 'Current',
                    settings: {
                      showLogo: true,
                      showTicker: true,
                      showDescription: true,
                    },
                    items: [],
                  }),
                  after: JSON.stringify({
                    name: 'Proposed',
                    settings: {
                      showLogo: true,
                      showTicker: true,
                      showDescription: true,
                    },
                    items: [],
                  }),
                },
              },
            },
          }}
        />
      )
    })

    expect(container.textContent).not.toContain('Proposed Watchlist Changes')
    expect(container.textContent).toContain('Proposed Entity Changes')

    await act(async () => {
      root.render(
        <InlineToolCall
          toolCall={{
            id: 'tool-watchlist-edit-malformed',
            name: 'edit_watchlist',
            state: ClientToolCallState.review,
            result: {
              entityKind: 'watchlist',
              documentFormat: 'tg-watchlist-document-v1',
              preview: {
                documentDiff: {
                  before: '',
                  after: JSON.stringify({
                    name: 'Proposed',
                    settings: {
                      showLogo: true,
                      showTicker: true,
                      showDescription: true,
                    },
                    items: [],
                  }),
                },
              },
            },
          }}
        />
      )
    })

    expect(container.textContent).not.toContain('Proposed Watchlist Changes')
    expect(container.textContent).toContain('Proposed Entity Changes')
  })
})
