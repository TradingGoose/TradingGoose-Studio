/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { act, cloneElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIndicatorWriteStore } from '@/hooks/queries/indicators'
import { listIndicatorWidget } from '@/widgets/widgets/list_indicator'

const indicatorMocks = vi.hoisted(() => ({
  create: vi.fn(),
  import: vi.fn(),
  delete: vi.fn(),
  members: [] as Array<{ entityId: string; entityName: string }>,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useUserPermissionsContext: () => ({
    canRead: true,
    canEdit: true,
  }),
}))

vi.mock('@/hooks/queries/indicators', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/queries/indicators')>()),
  createIndicator: indicatorMocks.create,
  importIndicators: indicatorMocks.import,
  deleteIndicator: indicatorMocks.delete,
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: vi.fn(),
    patchWidgetLinkedParams: vi.fn(),
  }),
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({ members: indicatorMocks.members, isLoading: false, error: null }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children?: React.ReactNode
    render?: React.ReactNode
  }) => <>{render ?? children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, render }: { children?: ReactNode; render: ReactElement }) =>
    cloneElement(render, undefined, children),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
        {
          disabled,
          ...props,
        },
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

describe('Indicator List header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    indicatorMocks.create.mockReset()
    indicatorMocks.import.mockReset()
    indicatorMocks.delete.mockReset()
    indicatorMocks.members.length = 0
    useIndicatorWriteStore.setState({ activeWrite: null, failedWrite: null })
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

  it('claims one synchronous panel write and keeps its feedback in that panel', async () => {
    let resolveCreate!: (value: Array<{ id: string }>) => void
    indicatorMocks.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve
      })
    )
    const header = listIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      channelId: 'pair-red',
      panelId: 'panel-1',
    } as any)

    await act(async () => root.render(header?.right as ReactNode))
    const create = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New indicator')
    )!
    act(() => {
      create.click()
      create.click()
    })

    expect(indicatorMocks.create).toHaveBeenCalledOnce()
    expect(useIndicatorWriteStore.getState().activeWrite).toMatchObject({
      kind: 'create',
      workspaceId: 'workspace-1',
      ownerId: 'panel-1',
    })

    const Body = listIndicatorWidget.component
    await act(async () => {
      root.render(
        <>
          <div data-panel='panel-1'>
            <Body channelId='pair-red' panelId='panel-1' context={{ workspaceId: 'workspace-1' }} />
          </div>
          <div data-panel='panel-2'>
            <Body channelId='pair-red' panelId='panel-2' context={{ workspaceId: 'workspace-1' }} />
          </div>
        </>
      )
    })
    expect(container.querySelector('[data-panel="panel-1"] [role="status"]')).toBeTruthy()
    expect(container.querySelector('[data-panel="panel-2"] [role="status"]')).toBeNull()

    await act(async () => resolveCreate([{ id: 'indicator-1' }]))
  })

  it('retains one owner-scoped alert after a rejected write', async () => {
    await useIndicatorWriteStore
      .getState()
      .runWrite({ kind: 'import', workspaceId: 'workspace-1', ownerId: 'panel-1' }, async () => {
        throw new Error('failed')
      })
    const Body = listIndicatorWidget.component
    await act(async () => {
      root.render(
        <Body channelId='pair-red' panelId='panel-1' context={{ workspaceId: 'workspace-1' }} />
      )
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not save indicator changes'
    )
  })

  it('keeps delete confirmation open after failure and closes it after retry', async () => {
    indicatorMocks.members.push(
      { entityId: 'indicator-1', entityName: 'RSI' },
      { entityId: 'indicator-2', entityName: 'MACD' }
    )
    indicatorMocks.delete
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined)
    const onWidgetLinkedParamsPatch = vi.fn()
    const Body = listIndicatorWidget.component

    await act(async () => {
      root.render(
        <Body
          channelId='pair-red'
          panelId='panel-1'
          context={{ workspaceId: 'workspace-1' }}
          params={{ indicatorId: 'indicator-1' }}
          onWidgetLinkedParamsPatch={onWidgetLinkedParamsPatch}
        />
      )
    })
    await act(async () => {
      container
        .querySelector('.group')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    const deleteTrigger = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete indicator')
    )!
    await act(async () => {
      deleteTrigger.click()
    })

    const getDialog = () => document.body.querySelector('[role="alertdialog"]')
    const clickDelete = async () => {
      const action = Array.from(getDialog()!.querySelectorAll('button')).find(
        (button) => button.textContent === 'Delete'
      )!
      await act(async () => {
        action.click()
        await Promise.resolve()
      })
    }

    await clickDelete()
    expect(getDialog()).toBeTruthy()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not save indicator changes'
    )
    expect(onWidgetLinkedParamsPatch).not.toHaveBeenCalled()

    await clickDelete()
    expect(indicatorMocks.delete).toHaveBeenCalledTimes(2)
    expect(getDialog()).toHaveAttribute('data-closed')
    expect(onWidgetLinkedParamsPatch).toHaveBeenCalledWith({ indicatorId: null })
  })

  it('imports valid unified indicator files', async () => {
    indicatorMocks.import.mockResolvedValue({})

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

    expect(indicatorMocks.import).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      file: {
        ...filePayload,
        indicators: [
          {
            name: 'RSI Export Example',
            pineCode: "indicator('RSI Export Example')",
          },
        ],
      },
    })
  })

  it('rejects invalid unified indicator files before calling the mutation', async () => {
    indicatorMocks.import.mockResolvedValue({})

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

    expect(indicatorMocks.import).not.toHaveBeenCalled()
  })
})
