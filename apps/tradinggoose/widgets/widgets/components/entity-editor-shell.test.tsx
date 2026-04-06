/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { EntityEditorShell, type EntityEditorShellConfig } from './entity-editor-shell'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let mockResolvedTargetState: {
  descriptor: ReviewTargetDescriptor | null
  isResolving: boolean
  error: string | null
  persistDescriptor: ReturnType<typeof vi.fn>
}
let mockWidgetChannelState: {
  resolvedPairColor: 'gray' | 'red'
  channelId: string
  isLinkedToColorPair: boolean
}
let mockPairContext: Record<string, unknown> | null
const mockSetPairContext = vi.fn()

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: null }),
}))

vi.mock('@/widgets/hooks/use-widget-channel', () => ({
  useWidgetChannel: () => mockWidgetChannelState,
}))

vi.mock('@/stores/dashboard/pair-store', () => ({
  usePairColorContext: () => mockPairContext,
  useSetPairColorContext: () => mockSetPairContext,
}))

vi.mock('@/widgets/widgets/entity_review/use-resolved-review-target', () => ({
  useResolvedReviewTarget: () => mockResolvedTargetState,
}))

vi.mock('@/lib/copilot/review-sessions/entity-session-host', () => ({
  EntitySessionHost: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='entity-session-host'>{children}</div>
  ),
}))

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <div data-testid='loading-agent'>loading</div>,
}))

const TEST_CONFIG: EntityEditorShellConfig = {
  entityKind: 'skill',
  fallbackWidgetKey: 'editor_skill',
  legacyIdKey: 'skillId',
  buildWidgetParams: () => null,
  buildPairContext: () => ({}),
  readEntitySelectionState: () => ({
    legacyEntityId: 'skill-1',
    reviewSessionId: 'review-1',
    reviewEntityId: 'skill-1',
    reviewDraftSessionId: null,
    descriptor: null,
  }),
  noWorkspaceMessage: 'Select a workspace to edit skills.',
  noSelectionMessage: 'Select a skill to edit.',
}

describe('EntityEditorShell', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockSetPairContext.mockReset()
    mockPairContext = null
    mockWidgetChannelState = {
      resolvedPairColor: 'gray',
      channelId: 'editor-skill-panel',
      isLinkedToColorPair: false,
    }
    mockResolvedTargetState = {
      descriptor: null,
      isResolving: false,
      error: null,
      persistDescriptor: vi.fn(),
    }
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('shows the resolve error when no descriptor is available', async () => {
    mockResolvedTargetState = {
      descriptor: null,
      isResolving: false,
      error: 'Review session not found',
      persistDescriptor: vi.fn(),
    }

    await act(async () => {
      root.render(
        <EntityEditorShell context={{ workspaceId: 'ws-1' }} config={TEST_CONFIG}>
          {() => <div data-testid='editor-child'>editor</div>}
        </EntityEditorShell>
      )
    })

    expect(container.textContent).toContain('Review session not found')
    expect(container.querySelector('[data-testid="loading-agent"]')).toBeNull()
    expect(container.querySelector('[data-testid="editor-child"]')).toBeNull()
  })

  it('keeps showing the loading state while a target is still resolving', async () => {
    mockResolvedTargetState = {
      descriptor: null,
      isResolving: true,
      error: null,
      persistDescriptor: vi.fn(),
    }

    await act(async () => {
      root.render(
        <EntityEditorShell context={{ workspaceId: 'ws-1' }} config={TEST_CONFIG}>
          {() => <div data-testid='editor-child'>editor</div>}
        </EntityEditorShell>
      )
    })

    expect(container.querySelector('[data-testid="loading-agent"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="editor-child"]')).toBeNull()
    expect(container.textContent).not.toContain('Review session not found')
  })

  it('publishes the current linked entity id into the pair store on mount', async () => {
    mockWidgetChannelState = {
      resolvedPairColor: 'red',
      channelId: 'pair-red',
      isLinkedToColorPair: true,
    }
    mockResolvedTargetState = {
      descriptor: null,
      isResolving: true,
      error: null,
      persistDescriptor: vi.fn(),
    }

    await act(async () => {
      root.render(
        <EntityEditorShell
          context={{ workspaceId: 'ws-1' }}
          pairColor='red'
          config={TEST_CONFIG}
        >
          {() => <div data-testid='editor-child'>editor</div>}
        </EntityEditorShell>
      )
    })

    expect(mockSetPairContext).toHaveBeenCalledWith('red', {
      skillId: 'skill-1',
    })
  })
})
