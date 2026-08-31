/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { act, cloneElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSkillWidget } from '@/widgets/widgets/list_skill'

const { mockCreateSkill, mockDeleteSkill, mockImportSkills, mockUseEntityList } = vi.hoisted(
  () => ({
    mockCreateSkill: vi.fn(),
    mockDeleteSkill: vi.fn(),
    mockImportSkills: vi.fn(),
    mockUseEntityList: vi.fn(),
  })
)

const importedSkill = {
  name: 'Market Research',
  description: 'Investigate the market.',
  content: 'Use multiple trusted sources.',
}
const skillFile = {
  version: '1',
  exportedAt: '2026-04-06T12:00:00.000Z',
  exportedFrom: 'skillList',
  resourceTypes: ['skills'],
  skills: [importedSkill],
}
const validSkillFile = { ...skillFile, fileType: 'tradingGooseExport' }
const createJsonFile = (value: unknown) => {
  const content = JSON.stringify(value)
  const file = new File([content], 'skills.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(content),
  })
  return file
}

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useUserPermissionsContext: () => ({
    canRead: true,
    canEdit: true,
  }),
}))

vi.mock('@/hooks/queries/skills', async () => {
  const actual = await vi.importActual<any>('@/hooks/queries/skills')
  return {
    ...actual,
    createSkill: mockCreateSkill,
    deleteSkill: mockDeleteSkill,
    importSkills: mockImportSkills,
  }
})

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: mockUseEntityList,
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: vi.fn(),
    patchWidgetLinkedParams: vi.fn(),
  }),
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

describe('Skill List header controls', () => {
  let container: HTMLDivElement
  let root: Root
  const renderHeader = async () => {
    const header = listSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)
    await act(async () => root.render(header?.right as ReactNode))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockCreateSkill.mockResolvedValue([{ id: 'skill-created' }])
    mockDeleteSkill.mockResolvedValue(undefined)
    mockImportSkills.mockResolvedValue({
      data: [],
      importedSkills: [],
      import: { addedCount: 0, renamedCount: 0 },
      success: true,
    })
    mockUseEntityList.mockReturnValue({
      members: [],
      isLoading: false,
      error: null,
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders import inside Manage skills and removes export', async () => {
    await renderHeader()

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[0]?.textContent).toContain('Manage skills')
    expect(container.textContent).toContain('New skill')
    expect(container.textContent).toContain('Import skills')
    expect(container.textContent).not.toContain('Export skills')
  })

  it('imports valid unified skill files', async () => {
    await renderHeader()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const file = createJsonFile(validSkillFile)

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockImportSkills).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      file: validSkillFile,
    })
  })

  it('rejects invalid unified skill files before calling the mutation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderHeader()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const file = createJsonFile(skillFile)

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    })

    await act(async () => {
      input!.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockImportSkills).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('settles deletion against the latest raw selection scope', async () => {
    const finishDeletes: Array<() => void> = []
    mockDeleteSkill.mockImplementation(
      () => new Promise<void>((resolve) => finishDeletes.push(resolve))
    )
    const members = [
      { entityId: 'skill-1', entityName: 'Research' },
      { entityId: 'skill-2', entityName: 'Execution' },
    ]
    const setMembers = (nextMembers: typeof members) =>
      mockUseEntityList.mockReturnValue({
        members: nextMembers,
        isLoading: false,
        error: null,
      })
    setMembers(members)
    const patchLinkedParams = vi.fn()
    const renderWorkspace = (workspaceId: string) =>
      listSkillWidget.component({
        channelId: 'channel-1',
        context: { workspaceId },
        params: { skillId: 'skill-1' },
        onWidgetLinkedParamsPatch: patchLinkedParams,
      })
    const openDeleteDialog = async () => {
      act(() => {
        Array.from(container.querySelectorAll('button'))
          .find((button) => button.textContent === 'Delete skill')
          ?.click()
      })
      return vi.waitFor(() => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (candidate) => candidate.textContent === 'Delete'
        )
        expect(button).toBeTruthy()
        return button!
      })
    }
    const confirmDelete = async (button: HTMLButtonElement) => {
      await act(async () => {
        button.click()
        await Promise.resolve()
      })
    }

    await act(async () => root.render(renderWorkspace('workspace-a')))
    const firstConfirmation = await openDeleteDialog()
    await act(async () => root.render(renderWorkspace('workspace-b')))
    await confirmDelete(firstConfirmation)
    expect(mockDeleteSkill).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-a',
      skillId: 'skill-1',
    })
    await act(async () => {
      finishDeletes[0]()
      await Promise.resolve()
    })
    expect(patchLinkedParams).not.toHaveBeenCalled()

    await act(async () => root.render(renderWorkspace('workspace-a')))
    await confirmDelete(await openDeleteDialog())
    setMembers([members[1]])
    await act(async () => root.render(renderWorkspace('workspace-a')))
    await act(async () => {
      finishDeletes[1]()
      await Promise.resolve()
    })

    expect(mockDeleteSkill).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-a',
      skillId: 'skill-1',
    })
    expect(patchLinkedParams).toHaveBeenCalledOnce()
    expect(patchLinkedParams).toHaveBeenCalledWith({ skillId: null })
  })

  it('serializes create and import before file reading', async () => {
    let finishCreate: ((skills: Array<{ id: string }>) => void) | undefined
    mockCreateSkill.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve
        })
    )
    await renderHeader()

    const createButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New skill')
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const readFile = vi.fn().mockResolvedValue('{}')
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ text: readFile }],
    })

    await act(async () => {
      createButton?.click()
      createButton?.click()
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockCreateSkill).toHaveBeenCalledOnce()
    expect(readFile).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Creating skill')

    await act(async () => {
      finishCreate?.([{ id: 'skill-created' }])
      await Promise.resolve()
    })
  })
})
