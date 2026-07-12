/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionBar } from './action-bar'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockActions = {
  collaborativeRemoveBlock: vi.fn(),
  collaborativeToggleBlockEnabled: vi.fn(),
  collaborativeDuplicateBlock: vi.fn(),
  collaborativeToggleBlockHandles: vi.fn(),
  collaborativeToggleBlockLocked: vi.fn(),
}

const mockBlocks: Record<string, any> = {
  block_1: {
    id: 'block_1',
    enabled: true,
    horizontalHandles: true,
    locked: false,
    data: {},
  },
}

const mockPermissions = {
  canAdmin: true,
  canEdit: true,
  isOfflineMode: false,
}

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => mockPermissions,
}))

vi.mock('@/blocks', () => ({
  getBlock: () => ({ category: 'actions' }),
}))

vi.mock('@/hooks/workflow/use-workflow-editor-actions', () => ({
  useWorkflowEditorActions: () => mockActions,
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowBlocks: () => mockBlocks,
}))

vi.mock('@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus', () => ({
  emitRemoveFromSubflow: vi.fn(),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('ActionBar', () => {
  let host: HTMLDivElement
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    container = document.createElement('div')
    host.appendChild(container)
    document.body.appendChild(host)
    root = createRoot(container)
    Object.values(mockActions).forEach((mockFn) => mockFn.mockReset())
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('contains toolbar pointer and click events while still running the button action', async () => {
    const parentMouseDown = vi.fn()
    const parentClick = vi.fn()

    host.addEventListener('mousedown', parentMouseDown)
    host.addEventListener('click', parentClick)

    await act(async () => {
      root.render(
        <ActionBar
          blockId='block_1'
          blockType='agent'
          workflowId='workflow_1'
          channelId='channel_1'
        />
      )
    })

    const enableButton = container.querySelector('button')
    expect(enableButton).not.toBeNull()

    await act(async () => {
      enableButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      enableButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(parentMouseDown).not.toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
    expect(mockActions.collaborativeToggleBlockEnabled).toHaveBeenCalledWith('block_1')
  })
})
