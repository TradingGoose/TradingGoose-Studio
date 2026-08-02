/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ControlBar } from './control-bar'

const mocks = vi.hoisted(() => ({
  canEdit: true,
  isExecuting: false,
  cancel: vi.fn(),
  deployProps: null as Record<string, unknown> | null,
  manualRunFeedback: { state: 'idle' } as
    | { state: 'idle' | 'running' | 'success' }
    | { state: 'error'; message: string },
  run: vi.fn(),
  shortcut: null as { handler: () => void; disabled: boolean } | null,
}))

vi.mock('@/components/ui', () => {
  const Wrapper = ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
    <>{render ?? children}</>
  )
  return {
    Button: ({ children, variant: _variant, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    DropdownMenu: Wrapper,
    DropdownMenuContent: Wrapper,
    DropdownMenuItem: Wrapper,
    DropdownMenuTrigger: Wrapper,
    Tooltip: Wrapper,
    TooltipContent: Wrapper,
    TooltipTrigger: Wrapper,
  }
})
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: null }) }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => console,
}))
vi.mock('@/lib/workflows/triggers', () => ({
  listWorkflowRunTriggers: () => [{ blockId: 'trigger-1' }],
}))
vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowBlocks: () => ({}),
  useWorkflowEdges: () => [],
}))
vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useWorkflowSession: () => ({ canEdit: mocks.canEdit }),
}))
vi.mock('@/app/workspace/[workspaceId]/components/use-keyboard-shortcuts', () => ({
  getKeyboardShortcutText: () => 'shortcut',
  useKeyboardShortcuts: (handler: () => void, disabled: boolean) => {
    mocks.shortcut = { handler, disabled }
  },
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canAdmin: true, isLoading: false }),
}))
vi.mock('@/hooks/workflow/use-workflow-execution', () => ({
  useWorkflowExecution: () => ({
    isExecuting: mocks.isExecuting,
    isWorkflowSessionReady: true,
    manualRunFeedback: mocks.manualRunFeedback,
    handleRunWorkflow: mocks.run,
    handleCancelExecution: mocks.cancel,
  }),
}))
vi.mock('@/widgets/widgets/editor_workflow/components/control-bar/components', () => ({
  DeploymentControls: (props: Record<string, unknown>) => {
    mocks.deployProps = props
    return null
  },
  ExportControls: () => <div data-testid='export' />,
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkflowRoute: () => ({ workflowId: 'workflow-1', channelId: 'channel-1' }),
}))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowEditorCopy: () => ({
    controlBar: new Proxy(
      {},
      {
        get: (_target, key) =>
          key === 'workflowFailed' ? 'Workflow failed: {error}' : String(key),
      }
    ),
  }),
}))

it('uses the session gate for mutations while keeping cancellation available', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ isDeployed: false }) }))
  )
  const render = async () => act(async () => root.render(<ControlBar />))

  await render()
  mocks.canEdit = false
  await render()
  expect(container.querySelector('button')?.disabled).toBe(true)
  expect(mocks.shortcut?.disabled).toBe(true)
  mocks.shortcut?.handler()
  expect(mocks.run).not.toHaveBeenCalled()
  expect(mocks.deployProps).toEqual(expect.objectContaining({ canEdit: false }))
  mocks.isExecuting = true
  await render()
  act(() => container.querySelector('button')?.click())
  expect(mocks.cancel).toHaveBeenCalledOnce()

  mocks.isExecuting = false
  mocks.manualRunFeedback = { state: 'running' }
  await render()
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  expect(container.querySelector('[role="alert"]')).toBeNull()

  mocks.manualRunFeedback = { state: 'success' }
  await render()
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)

  mocks.manualRunFeedback = { state: 'error', message: 'Driver failed' }
  await render()
  expect(container.querySelector('[role="status"]')).toBeNull()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Driver failed')

  mocks.manualRunFeedback = { state: 'idle' }
  await render()
  expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull()
  act(() => root.unmount())
  vi.unstubAllGlobals()
})
