/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkflowChatDeploymentRequest } from '@/stores/copilot/types'
import { WorkflowChatDeploymentDialog } from './workflow-chat-deployment-dialog'

const m = vi.hoisted(() => ({
  request: null as WorkflowChatDeploymentRequest | null,
  current: true,
  freshLoading: false,
  permissions: { isLoading: false, error: null as string | null, canEdit: true, canAdmin: true },
  authPending: false,
  authUser: { id: 'actor-a', email: 'synthetic@example.invalid', name: 'Synthetic' } as {
    id: string
    email: string
    name: string
  } | null,
  session: {
    workflowId: 'target-a',
    doc: {},
    isSynced: true,
    isLoading: false,
    error: null as string | null,
    canEdit: true,
  },
  blocks: { chat: { id: 'chat-a', type: 'chat_trigger', subBlocks: {} } } as Record<
    string,
    { id: string; type: string; subBlocks: object }
  >,
  read: vi.fn(),
  settle: vi.fn(),
  permissionReads: vi.fn(),
  updatePermissions: vi.fn(),
  refetchPermissions: vi.fn(),
  router: { replace: vi.fn() },
  sessions: vi.fn(),
  routes: vi.fn(),
  modal: vi.fn(),
}))
vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: (
    selector?: (state: {
      workflowChatDeployment: WorkflowChatDeploymentRequest | null
      readPendingTool: typeof m.read
      settleWorkflowChatDeployment: typeof m.settle
    }) => unknown
  ) => {
    const state = {
      workflowChatDeployment: m.request,
      readPendingTool: m.read,
      settleWorkflowChatDeployment: m.settle,
    }
    return selector ? selector(state) : state
  },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    isPending: m.authPending,
    data: m.authUser ? { user: m.authUser } : null,
  }),
}))
vi.mock('@/hooks/use-workspace-permissions', () => ({
  useWorkspacePermissions: (...args: unknown[]) => {
    m.permissionReads(...args)
    return {
      permissions: {
        users: [],
        total: 0,
        currentUserPermission: m.permissions.canAdmin
          ? 'admin'
          : m.permissions.canEdit
            ? 'write'
            : 'read',
      },
      loading: m.freshLoading || m.permissions.isLoading,
      error: m.permissions.error,
      updatePermissions: m.updatePermissions,
      refetch: m.refetchPermissions,
    }
  },
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => m.router }))
vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useWorkflowSession: () => m.session,
  WorkflowSessionProvider: (props: {
    children: ReactNode
    workflowId: string
    workspaceId: string
  }) => {
    m.sessions(props)
    return props.children
  },
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  WorkflowRouteProvider: (props: {
    children: ReactNode
    workflowId: string
    workspaceId: string
    channelId: string
  }) => {
    m.routes(props)
    return props.children
  },
}))
vi.mock('@/lib/yjs/use-workflow-doc', () => ({ useWorkflowBlocks: () => m.blocks }))
vi.mock('@/blocks', () => ({
  getBlock: (type: string) =>
    type === 'chat_trigger' ? { category: 'triggers', triggers: { available: ['chat'] } } : null,
}))
vi.mock('@/triggers/registry', () => ({ TRIGGER_REGISTRY: { chat: {} } }))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/deploy-modal',
  () => ({
    DeployModal: (props: {
      open: boolean
      workflowId: string
      initialTab: string
      container: HTMLElement | null
      onChatRendered: () => void
      onOpenChange: (open: boolean) => void
    }) => {
      m.modal(props)
      return props.open ? (
        <div role='dialog' data-target={props.workflowId}>
          <button onClick={props.onChatRendered}>Commit target chat form seam</button>
          <button onClick={() => props.onOpenChange(false)}>Close target dialog</button>
        </div>
      ) : null
    },
  })
)
let root: Root
let container: HTMLDivElement
const render = () =>
  act(async () =>
    root.render(
      <>
        <div data-visible-workflow='target-b'>Visible editor B remains selected</div>
        <WorkflowChatDeploymentDialog ownerUserId='actor-a' />
      </>
    )
  )
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  m.current = true
  m.freshLoading = false
  m.permissions = { isLoading: false, error: null, canEdit: true, canAdmin: true }
  m.authPending = false
  m.authUser = { id: 'actor-a', email: 'synthetic@example.invalid', name: 'Synthetic' }
  m.session = {
    workflowId: 'target-a',
    doc: {},
    isSynced: true,
    isLoading: false,
    error: null,
    canEdit: true,
  }
  m.blocks = { chat: { id: 'chat-a', type: 'chat_trigger', subBlocks: {} } }
  m.request = {
    id: 'dialog-a',
    toolCallId: 'call-a',
    workflowId: 'target-a',
    workspaceId: 'workspace-a',
    opened: false,
    isCurrent: () => m.current,
  }
  m.read.mockResolvedValue({
    stage: 'result',
    target: { toolName: 'deploy_workflow' },
    originalArgs: { action: 'deploy', deployType: 'chat', entityId: 'target-a' },
  })
  m.settle.mockImplementation((id: string, outcome: string) => {
    if (m.request?.id !== id) return
    m.request = outcome === 'opened' ? { ...m.request, opened: true } : null
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/deployed')
        ? new Response(null, { status: 404 })
        : Response.json({ isDeployed: false, needsRedeployment: false })
    )
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

it('owns exact cold target A independently of visible B and waits for a committed panel before settlement', async () => {
  await render()
  expect(m.permissionReads).toHaveBeenLastCalledWith('workspace-a', 'actor-a', {
    requireFresh: true,
  })
  expect(m.sessions.mock.lastCall?.[0]).toMatchObject({
    workspaceId: 'workspace-a',
    workflowId: 'target-a',
  })
  expect(m.routes.mock.lastCall?.[0]).toMatchObject({
    workspaceId: 'workspace-a',
    workflowId: 'target-a',
    channelId: 'copilot-chat-deployment:dialog-a',
  })
  expect(container.querySelector('[data-visible-workflow="target-b"]')).not.toBeNull()
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  expect(m.modal.mock.lastCall?.[0]).toMatchObject({ workflowId: 'target-a', initialTab: 'chat' })
  expect(m.modal.mock.lastCall?.[0].container.isConnected).toBe(true)
  expect(m.read).toHaveBeenCalledExactlyOnceWith('call-a')
  expect(m.settle).not.toHaveBeenCalled()
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click()
  )
  expect(m.settle).toHaveBeenCalledExactlyOnceWith('dialog-a', 'opened')
  await render()
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(
        ([url, init]) =>
          String(url).includes('/target-a/') && (!init?.method || init.method === 'GET')
      )
  ).toBe(true)
})

it('does not acquire a target session while the existing permission record is freshly checked', async () => {
  m.freshLoading = true
  await render()
  expect(m.sessions).not.toHaveBeenCalled()
  expect(m.read).not.toHaveBeenCalled()
  expect(m.settle).not.toHaveBeenCalled()
  m.freshLoading = false
  await render()
  expect(m.sessions).toHaveBeenCalled()
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
})

it('waits for exact synced session readiness before querying Pending or opening the modal', async () => {
  m.session.isLoading = true
  m.session.isSynced = false
  await render()
  expect(m.read).not.toHaveBeenCalled()
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  m.session.isLoading = false
  m.session.isSynced = true
  await render()
  expect(m.read).toHaveBeenCalledOnce()
})

it('waits for the authenticated session before acquiring the workflow session', async () => {
  m.authPending = true
  m.authUser = null
  await render()
  expect(m.sessions).not.toHaveBeenCalled()
  expect(m.read).not.toHaveBeenCalled()
  expect(m.settle).not.toHaveBeenCalled()
  m.authPending = false
  m.authUser = { id: 'actor-a', email: 'synthetic@example.invalid', name: 'Synthetic' }
  await render()
  expect(m.sessions.mock.lastCall?.[0]).toMatchObject({ user: { id: 'actor-a' } })
  expect(m.read).toHaveBeenCalledOnce()
})

it('closes the dialog when its authenticated session disappears', async () => {
  await render()
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  m.authUser = null
  await render()
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(m.settle).toHaveBeenCalledWith(
    'dialog-a',
    'error',
    'Authenticated workflow session is missing'
  )
})

it.each(['permission', 'session-error', 'wrong-session', 'missing-chat', 'stale'] as const)(
  'refuses %s without a rendered or acknowledged chat dialog',
  async (kind) => {
    if (kind === 'permission') m.permissions.canAdmin = false
    if (kind === 'session-error') m.session.error = 'Target session unavailable'
    if (kind === 'wrong-session') m.session.workflowId = 'target-b'
    if (kind === 'missing-chat') m.blocks = {}
    if (kind === 'stale') m.current = false
    await render()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(m.settle.mock.calls.some(([, outcome]) => outcome === 'opened')).toBe(false)
    expect(m.settle).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  }
)

it('refuses a late native Pending reply when the selection has changed', async () => {
  let finish!: (value: object) => void
  m.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  await render()
  expect(m.read).toHaveBeenCalledOnce()
  m.current = false
  await act(async () =>
    finish({
      stage: 'result',
      target: { toolName: 'deploy_workflow' },
      originalArgs: { action: 'deploy', deployType: 'chat', entityId: 'target-a' },
    })
  )
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(m.settle.mock.calls.some(([, outcome]) => outcome === 'opened')).toBe(false)
})

it('closes the request when its actual session owner unmounts', async () => {
  await render()
  await act(async () => {
    root.render(<div>Another owner</div>)
    await Promise.resolve()
  })
  expect(
    m.settle.mock.calls.some(([id, outcome]) => id === 'dialog-a' && outcome === 'closed')
  ).toBe(true)
  expect(document.body.querySelector('[data-copilot-deployment]')).toBeNull()
})
