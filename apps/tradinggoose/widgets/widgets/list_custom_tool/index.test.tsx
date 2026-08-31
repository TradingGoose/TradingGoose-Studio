/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { act, cloneElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listCustomToolWidget } from '@/widgets/widgets/list_custom_tool'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  import: vi.fn(),
  selectWhenListed: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useUserPermissionsContext: () => ({ canEdit: true, canRead: true }),
}))

vi.mock('@/hooks/queries/custom-tools', async () => {
  const actual = await vi.importActual<any>('@/hooks/queries/custom-tools')
  return {
    ...actual,
    createCustomTool: mocks.create,
    importCustomTools: mocks.import,
  }
})

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({ members: [] }),
}))

vi.mock('@/widgets/utils/use-pending-entity-selection', () => ({
  usePendingEntitySelection: () => mocks.selectWhenListed,
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({ patchWidgetLinkedParams: vi.fn() }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactNode }) => (
    <>{render ?? children}</>
  ),
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children, render }: { children?: ReactNode; render: ReactElement }) =>
    cloneElement(render, undefined, children),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    disabled,
    closeOnClick: _closeOnClick,
    render,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    closeOnClick?: boolean
    render?: ReactElement
  }) =>
    render ? (
      cloneElement(
        render as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>,
        { disabled, ...props },
        children
      )
    ) : (
      <button type='button' disabled={disabled} {...props}>
        {children}
      </button>
    ),
}))

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: () => 'controls',
  widgetHeaderIconButtonClassName: () => 'icon-button',
  widgetHeaderMenuContentClassName: 'menu-content',
  widgetHeaderMenuIconClassName: 'menu-icon',
  widgetHeaderMenuItemClassName: 'menu-item',
  widgetHeaderMenuTextClassName: 'menu-text',
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('Custom Tool List header writes', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    mocks.create.mockReset()
    mocks.import.mockReset()
    mocks.selectWhenListed.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderHeader = async () => {
    const header = listCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
    } as any)
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>{header?.right as ReactNode}</QueryClientProvider>
      )
    })
  }

  it('keeps visible create progress and blocks duplicate activation', async () => {
    let resolveCreate!: (value: Array<{ id: string }>) => void
    mocks.create.mockReturnValue(
      new Promise<Array<{ id: string }>>((resolve) => {
        resolveCreate = resolve
      })
    )
    await renderHeader()
    const create = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New custom tool')
    )!

    await act(async () => {
      create.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Creating custom tool'
    )
    create.click()
    expect(mocks.create).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveCreate([{ id: 'tool-1' }])
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(mocks.selectWhenListed).toHaveBeenCalledWith('tool-1')
  })
})
