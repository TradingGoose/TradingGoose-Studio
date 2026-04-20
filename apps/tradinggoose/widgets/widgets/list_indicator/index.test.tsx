/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listIndicatorWidget } from '@/widgets/widgets/list_indicator'

const mockCreateIndicatorMutation = vi.fn()
const mockImportIndicatorsMutation = vi.fn()

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useUserPermissionsContext: () => ({
    canRead: true,
    canEdit: true,
  }),
}))

vi.mock('@/hooks/queries/indicators', async () => {
  const actual = await vi.importActual<any>('@/hooks/queries/indicators')
  return {
    ...actual,
    useCreateIndicator: () => mockCreateIndicatorMutation(),
    useImportIndicators: () => mockImportIndicatorsMutation(),
  }
})

vi.mock('@/widgets/utils/indicator-selection', () => ({
  emitIndicatorSelectionChange: vi.fn(),
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

describe('Indicator List header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockCreateIndicatorMutation.mockReturnValue(createMutationState())
    mockImportIndicatorsMutation.mockReturnValue(createMutationState())
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders New indicator first and Import indicator second in the Create menu', async () => {
    const header = listIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[0]?.textContent).toContain('Create indicator')
    expect(buttons[1]?.textContent).toContain('New indicator')
    expect(buttons[2]?.textContent).toContain('Import indicator')
  })

  it('imports valid unified indicator files', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockImportIndicatorsMutation.mockReturnValue(createMutationState(mutateAsync))

    const header = listIndicatorWidget.renderHeader?.({
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
      exportedFrom: 'indicatorEditor',
      resourceTypes: ['indicators'],
      skills: [],
      workflows: [],
      customTools: [],
      watchlists: [],
      indicators: [
        {
          name: 'RSI Export Example',
          color: '#3972F6',
          pineCode: "indicator('RSI Export Example')",
          inputMeta: {},
        },
      ],
    }

    const file = new File([JSON.stringify(filePayload)], 'indicator.json', {
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

  it('rejects invalid unified indicator files before calling the mutation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockImportIndicatorsMutation.mockReturnValue(createMutationState(mutateAsync))

    const header = listIndicatorWidget.renderHeader?.({
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
      exportedFrom: 'indicatorEditor',
      resourceTypes: ['indicators'],
      indicators: [
        {
          name: 'RSI Export Example',
          pineCode: "indicator('RSI Export Example')",
        },
      ],
    }

    const file = new File([JSON.stringify(invalidPayload)], 'indicator.json', {
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
