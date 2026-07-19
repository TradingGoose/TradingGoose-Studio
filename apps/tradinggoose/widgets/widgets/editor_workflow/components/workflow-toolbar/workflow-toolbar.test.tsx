/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { WorkflowToolbar } from './workflow-toolbar'

const mocks = vi.hoisted(() => ({
  addBlock: null as ((request: { type: string }) => void) | null,
  dispatch: vi.fn(),
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <>{children}</>
  return {
    DropdownMenu: Wrapper,
    DropdownMenuContent: Wrapper,
    DropdownMenuItem: Wrapper,
    DropdownMenuTrigger: Wrapper,
  }
})
vi.mock('@/components/ui/input', () => ({ Input: (props: any) => <input {...props} /> }))
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/tooltip', () => {
  const Wrapper = ({ children }: { children: ReactNode }) => <>{children}</>
  return {
    Tooltip: Wrapper,
    TooltipContent: Wrapper,
    TooltipProvider: Wrapper,
    TooltipTrigger: Wrapper,
  }
})
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useUserPermissionsContext: () => ({ canEdit: true }),
}))
vi.mock('@/lib/workflows/block-availability', () => ({
  getProviderIdsForBlocks: () => [],
  isBlockAvailable: () => true,
}))
vi.mock('@/lib/workflows/trigger-utils', () => ({
  getBlocksForSidebar: () => [],
  getTriggersForSidebar: () => [],
  hasTriggerCapability: () => false,
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-context',
  () => ({
    ToolbarAddBlockProvider: ({ children, onAddBlock }: any) => {
      mocks.addBlock = onAddBlock
      return <>{children}</>
    },
    useToolbarAddBlock: () => mocks.addBlock,
  })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-dispatcher',
  () => ({ dispatchToolbarAddBlock: mocks.dispatch })
)
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowI18n: () => ({
    workflowToolbarCopy: new Proxy({}, { get: (_target, key) => String(key) }),
    getLocalizedBlockMetadata: ({ name, description }: any) => ({ name, description }),
    getLocalizedBlockName: (name: string) => name,
    getToolbarDisabledReason: () => 'Disabled',
  }),
}))

it('disables open toolbar actions when the runtime becomes read-only', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  )
  const render = async (canWrite: boolean) => {
    await act(async () => {
      root.render(
        <WorkflowToolbar workspaceId='workspace-1' toolbarScopeId='scope-1' canWrite={canWrite} />
      )
    })
  }

  await render(true)
  mocks.addBlock?.({ type: 'agent' })
  expect(mocks.dispatch).toHaveBeenCalledOnce()
  await render(false)
  mocks.addBlock?.({ type: 'agent' })

  expect(mocks.dispatch).toHaveBeenCalledOnce()
  expect(
    [...container.querySelectorAll('button,input')].every((element: any) => element.disabled)
  ).toBe(true)
  act(() => root.unmount())
  vi.unstubAllGlobals()
})
