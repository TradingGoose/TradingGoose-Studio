/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DeployModal } from './deploy-modal'

const m = vi.hoisted(() => ({
  blocks: {
    chat: { id: 'chat-a', name: 'Chat A', type: 'chat_trigger', subBlocks: {} },
    api: { id: 'api-a', name: 'API A', type: 'api_trigger', subBlocks: {} },
  } as Record<string, { id: string; name: string; type: string; subBlocks: object }>,
  rendered: vi.fn(),
  setValue: vi.fn(),
  values: {} as Record<string, unknown>,
}))
vi.mock('@/components/ui', async () => {
  const Wrapper = ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
    <>{render ?? children}</>
  )
  const { Button } = await import('@/components/ui/button')
  const { Input } = await import('@/components/ui/input')
  const { Label } = await import('@/components/ui/label')
  const { Textarea } = await import('@/components/ui/textarea')
  const { Card, CardContent } = await import('@/components/ui/card')
  const { Alert, AlertDescription } = await import('@/components/ui/alert')
  return {
    Button,
    Input,
    Label,
    Textarea,
    Card,
    CardContent,
    Alert,
    AlertDescription,
    DropdownMenu: Wrapper,
    DropdownMenuContent: Wrapper,
    DropdownMenuItem: Wrapper,
    DropdownMenuTrigger: Wrapper,
    Tabs: Wrapper,
    TabsList: Wrapper,
    TabsTrigger: Wrapper,
    Tooltip: Wrapper,
    TooltipContent: Wrapper,
    TooltipTrigger: Wrapper,
    ImageUpload: () => null,
  }
})
vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowBlocks: () => m.blocks,
  useWorkflowEdges: () => [],
  useWorkflowLoops: () => ({}),
  useWorkflowParallels: () => ({}),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true, canAdmin: true }),
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkspaceId: () => 'workspace-a',
}))
vi.mock('@/hooks/workflow/use-workflow-editor-actions', () => ({
  useWorkflowEditorActions: () => ({ collaborativeToggleBlockAdvancedMode() {} }),
}))
vi.mock('@/blocks', () => ({
  getBlock: (type: string) => ({
    category: 'triggers',
    subBlocks: [],
    outputs: {},
    triggers: { available: [type === 'chat_trigger' ? 'chat' : 'api'] },
  }),
}))
vi.mock('@/triggers/registry', () => ({ TRIGGER_REGISTRY: { chat: {}, api: {} } }))
vi.mock('@/triggers', () => ({ getTrigger: () => ({}), isNativeTrigger: () => true }))
vi.mock('@/stores/workflows/utils', () => ({ mergeSubblockState: (blocks: object) => blocks }))
vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test' },
  getEnv: () => 'https://synthetic.example.invalid',
  isTruthy: (value: unknown) => value === true || value === 'true',
}))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => {
  const chat = new Proxy({}, { get: (_target, key) => String(key) })
  const copy = new Proxy(
    { chat },
    { get: (target, key) => (key === 'chat' ? target.chat : String(key)) }
  )
  return {
    useDeploymentCopy: () => copy,
    useWorkflowApiKeyCopy: () => copy,
    useWorkflowEditorCopy: () => copy,
    useWorkflowI18n: () => ({ workflowInspectorCopy: {} }),
  }
})
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (blockId: string, subBlockId: string) => [
      m.values[subBlockId] ?? null,
      (value: unknown) => m.setValue(blockId, subBlockId, value),
    ],
  })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/chat-deploy/components/identifier-input',
  () => ({
    IdentifierInput: () => <input aria-label='identifier-field-seam' />,
  })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/chat-deploy/components/auth-selector',
  () => ({ AuthSelector: () => null })
)
vi.mock('@/widgets/widgets/workflow_chat/components/output-select/output-select', () => ({
  OutputSelect: () => null,
}))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/control-bar/components/api-key-selector/api-key-selector',
  () => ({ ApiKeySelector: () => null })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/deployment-info/components/deploy-status/deploy-status',
  () => ({ DeployStatus: () => null })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/control-bar/components/deploy-modal/components/deployment-info/deployment-info',
  () => ({ DeploymentInfo: () => null })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/control-bar/components/deployment-controls/components/deployed-workflow-card',
  () => ({ DeployedWorkflowCard: () => <div>Workflow preview</div> })
)
vi.mock('@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-edit-rows', () => ({
  SubBlockEditRows: () => null,
}))

let root: Root
let fixture: HTMLDivElement
let owned: HTMLDivElement
let globalRoot: HTMLDivElement
const props = () => ({
  open: true,
  onOpenChange: vi.fn(),
  workflowId: 'target-a',
  isDeployed: false,
  needsRedeployment: false,
  setNeedsRedeployment: vi.fn(),
  deployedState: null,
  isLoadingDeployedState: false,
  refetchDeployedState: vi.fn(async () => {}),
  refetchDeploymentStatus: vi.fn(async () => false),
})
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  m.values = {}
  m.blocks = {
    chat: { id: 'chat-a', name: 'Chat A', type: 'chat_trigger', subBlocks: {} },
    api: { id: 'api-a', name: 'API A', type: 'api_trigger', subBlocks: {} },
  }
  fixture = document.createElement('div')
  owned = document.createElement('div')
  owned.id = 'owned-chat-deployment'
  globalRoot = document.createElement('div')
  globalRoot.id = 'workflow-editor-overlay-root-target-a'
  document.body.append(fixture, owned, globalRoot)
  root = createRoot(fixture)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ keys: [], versions: [], isDeployed: false }))
  )
})
afterEach(() => {
  act(() => root.unmount())
  fixture.remove()
  owned.remove()
  globalRoot.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

it('renders the actual target ChatDeploy form into the explicit container before notifying its committed callback', async () => {
  // JSDOM has no layout; native focus guards need visible tabbable controls.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 100, 20),
  ] as unknown as DOMRectList)
  const value = props()
  const newChat = document.createElement('button')
  newChat.textContent = 'New Chat'
  globalRoot.append(newChat)
  newChat.focus()
  await act(async () =>
    root.render(
      <DeployModal
        {...value}
        open={false}
        container={owned}
        initialTab='chat'
        onChatRendered={m.rendered}
      />
    )
  )
  expect(m.rendered).not.toHaveBeenCalled()
  await act(async () =>
    root.render(
      <DeployModal {...value} container={owned} initialTab='chat' onChatRendered={m.rendered} />
    )
  )
  expect(owned.querySelector('[role="dialog"]')).not.toBeNull()
  expect(globalRoot.querySelector('[role="dialog"]')).toBeNull()
  expect(
    owned.querySelector('[data-workflow-id="target-a"][data-chat-block-id="chat-a"]')
  ).not.toBeNull()
  expect(owned.querySelector('input#chat-title')).not.toBeNull()
  expect(owned.querySelector('textarea#chat-description')).not.toBeNull()
  const dialog = owned.querySelector<HTMLElement>('[role="dialog"]')!
  await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  expect(newChat.closest('[aria-hidden="true"]')).not.toBeNull()
  const guards = owned.querySelectorAll<HTMLElement>('[data-base-ui-focus-guard]')
  expect(guards).toHaveLength(2)
  for (const guard of guards) {
    await act(async () => guard.focus())
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  }
  expect(m.rendered).toHaveBeenCalledOnce()
  expect(
    vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')
  ).toBe(true)
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  )
  expect(value.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  await act(async () =>
    root.render(<DeployModal {...value} open={false} container={owned} initialTab='chat' />)
  )
  await vi.waitFor(() => expect(document.activeElement).toBe(newChat))
})

it('keeps confirmations and previews inside their parent popup stacking context', async () => {
  await act(async () =>
    root.render(
      <DeployModal
        {...props()}
        container={owned}
        isDeployed
        needsRedeployment
        deployedState={{ blocks: {}, edges: [], loops: {}, parallels: {} }}
      />
    )
  )
  const parent = owned.querySelector<HTMLElement>('[role="dialog"]')!
  const click = async (scope: Element, label: string) =>
    act(async () => {
      ;[...scope.querySelectorAll('button')].find((button) => button.textContent === label)!.click()
    })
  await click(parent, 'undeploy')
  const confirmation = document.querySelector('[role="alertdialog"]')!
  expect(parent.contains(confirmation)).toBe(true)
  await click(confirmation, 'cancel')
  await click(parent, 'viewDeployment')
  const preview = parent.querySelector('[role="dialog"]')!
  expect(preview).not.toBeNull()
  await click(preview, 'loadDeployment')
  expect(preview.contains(document.querySelector('[role="alertdialog"]'))).toBe(true)
})

it('does not reset explicit Chat to Billing when asynchronous API keys change fallback selection', async () => {
  const value = props()
  let keys!: (response: Response) => void
  const keysResponse = new Promise<Response>((resolve) => {
    keys = resolve
  })
  vi.mocked(fetch).mockImplementation(async (input) =>
    String(input).includes('/workspace-a/api-keys')
      ? keysResponse
      : Response.json({ keys: [], versions: [], isDeployed: false })
  )
  await act(async () =>
    root.render(
      <DeployModal {...value} container={owned} initialTab='chat' onChatRendered={m.rendered} />
    )
  )
  expect(owned.querySelector('input#chat-title')).not.toBeNull()
  await act(async () =>
    keys(Response.json({ keys: [{ id: 'shared-key', name: 'Synthetic key' }] }))
  )
  expect(owned.querySelector('input#chat-title')).not.toBeNull()
  expect(m.rendered).toHaveBeenCalledOnce()
})

it('retains ordinary default Billing behavior without an explicit chat request', async () => {
  await act(async () =>
    root.render(<DeployModal {...props()} container={owned} onChatRendered={m.rendered} />)
  )
  expect(owned.querySelector('[role="dialog"]')).not.toBeNull()
  expect(owned.querySelector('input#chat-title')).toBeNull()
  expect(m.rendered).not.toHaveBeenCalled()
})

it('cannot acknowledge Chat when the actual target has no chat trigger', async () => {
  m.blocks = { api: m.blocks.api }
  await act(async () =>
    root.render(
      <DeployModal {...props()} container={owned} initialTab='chat' onChatRendered={m.rendered} />
    )
  )
  expect(owned.querySelector('[data-chat-block-id]')).toBeNull()
  expect(m.rendered).not.toHaveBeenCalled()
})
