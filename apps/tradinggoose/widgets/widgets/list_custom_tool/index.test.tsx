/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { listCustomToolWidget } from '@/widgets/widgets/list_custom_tool'

const mockCreateCustomToolMutation = vi.fn()
const mockImportCustomToolsMutation = vi.fn()

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useUserPermissionsContext: () => ({
    canRead: true,
    canEdit: true,
  }),
}))

vi.mock('@/hooks/queries/custom-tools', async () => {
  const actual = await vi.importActual<any>('@/hooks/queries/custom-tools')
  return {
    ...actual,
    useCreateCustomTool: () => mockCreateCustomToolMutation(),
    useImportCustomTools: () => mockImportCustomToolsMutation(),
  }
})

vi.mock('@/widgets/utils/custom-tool-selection', () => ({
  emitCustomToolSelectionChange: vi.fn(),
  useCustomToolSelectionPersistence: vi.fn(),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    onSelect?: (event: Event) => void
  }) => (
    <button type='button' disabled={disabled} onClick={() => onSelect?.(new Event('select'))}>
      {children}
    </button>
  ),
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
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

const createMutationState = (mutateAsync = vi.fn()) => ({
  isPending: false,
  mutateAsync,
})

describe('Custom Tool List header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useCustomToolsStore.getState().resetAll()

    mockCreateCustomToolMutation.mockReturnValue(createMutationState())
    mockImportCustomToolsMutation.mockReturnValue(createMutationState())
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useCustomToolsStore.getState().resetAll()
  })

  it('renders import inside Create and keeps New custom tool in the menu', async () => {
    const header = listCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[0]?.textContent).toContain('Create custom tool')
    expect(container.textContent).toContain('Import custom tools')
    expect(container.textContent).toContain('New custom tool')
  })

  it('imports valid unified custom-tool files', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockImportCustomToolsMutation.mockReturnValue(createMutationState(mutateAsync))

    const header = listCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const filePayload = {
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'customToolEditor',
      resourceTypes: ['customTools'],
      skills: [],
      workflows: [],
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: {
            type: 'function',
            function: {
              name: 'fetchTopMovers',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: 'return { movers: [] }',
        },
      ],
      watchlists: [],
      indicators: [],
    }

    const file = new File([JSON.stringify(filePayload)], 'custom-tools.json', {
      type: 'application/json',
    })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () => Promise.resolve(JSON.stringify(filePayload)),
    })

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mutateAsync).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      file: filePayload,
    })
  })

  it('rejects invalid unified custom-tool files before calling the mutation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockImportCustomToolsMutation.mockReturnValue(createMutationState(mutateAsync))

    const header = listCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const invalidPayload = {
      version: '1',
      exportedAt: '2026-04-08T15:30:00.000Z',
      exportedFrom: 'customToolEditor',
      resourceTypes: ['customTools'],
      customTools: [
        {
          title: 'Fetch Top Movers',
          schema: {
            type: 'function',
            function: {
              name: 'fetchTopMovers',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
          code: 'return { movers: [] }',
        },
      ],
    }

    const file = new File([JSON.stringify(invalidPayload)], 'custom-tools.json', {
      type: 'application/json',
    })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () => Promise.resolve(JSON.stringify(invalidPayload)),
    })

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mutateAsync).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
