/**
 * @vitest-environment jsdom
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillsStore } from '@/stores/skills/store'
import { listSkillWidget } from '@/widgets/widgets/list_skill'

const mockCreateSkillMutation = vi.fn()
const mockImportSkillsMutation = vi.fn()

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
    useCreateSkill: () => mockCreateSkillMutation(),
    useImportSkills: () => mockImportSkillsMutation(),
  }
})

vi.mock('@/widgets/utils/skill-selection', () => ({
  emitSkillSelectionChange: vi.fn(),
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

describe('Skill List header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useSkillsStore.getState().resetAll()

    mockCreateSkillMutation.mockReturnValue(createMutationState())
    mockImportSkillsMutation.mockReturnValue(createMutationState())
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useSkillsStore.getState().resetAll()
  })

  it('renders import inside Manage skills and removes export', async () => {
    const header = listSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[0]?.textContent).toContain('Manage skills')
    expect(container.textContent).toContain('New skill')
    expect(container.textContent).toContain('Import skills')
    expect(container.textContent).not.toContain('Export skills')
  })

  it('imports valid unified skill files', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockImportSkillsMutation.mockReturnValue(createMutationState(mutateAsync))

    const header = listSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const file = new File(
      [
        JSON.stringify({
          version: '1',
          fileType: 'tradingGooseExport',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'skillList',
          resourceTypes: ['skills'],
          skills: [
            {
              name: 'Market Research',
              description: 'Investigate the market.',
              content: 'Use multiple trusted sources.',
            },
          ],
        }),
      ],
      'skills.json',
      { type: 'application/json' }
    )
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () =>
        Promise.resolve(
          JSON.stringify({
            version: '1',
            fileType: 'tradingGooseExport',
            exportedAt: '2026-04-06T12:00:00.000Z',
            exportedFrom: 'skillList',
            resourceTypes: ['skills'],
            skills: [
              {
                name: 'Market Research',
                description: 'Investigate the market.',
                content: 'Use multiple trusted sources.',
              },
            ],
          })
        ),
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
      file: {
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'skillList',
        resourceTypes: ['skills'],
        skills: [
          {
            name: 'Market Research',
            description: 'Investigate the market.',
            content: 'Use multiple trusted sources.',
          },
        ],
      },
    })
  })

  it('rejects invalid unified skill files before calling the mutation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockImportSkillsMutation.mockReturnValue(createMutationState(mutateAsync))

    const header = listSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).toBeTruthy()

    const file = new File(
      [
        JSON.stringify({
          version: '1',
          exportedAt: '2026-04-06T12:00:00.000Z',
          exportedFrom: 'skillList',
          resourceTypes: ['skills'],
          skills: [
            {
              name: 'Market Research',
              description: 'Investigate the market.',
              content: 'Use multiple trusted sources.',
            },
          ],
        }),
      ],
      'skills.json',
      { type: 'application/json' }
    )
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: () =>
        Promise.resolve(
          JSON.stringify({
            version: '1',
            exportedAt: '2026-04-06T12:00:00.000Z',
            exportedFrom: 'skillList',
            resourceTypes: ['skills'],
            skills: [
              {
                name: 'Market Research',
                description: 'Investigate the market.',
                content: 'Use multiple trusted sources.',
              },
            ],
          })
        ),
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
    consoleError.mockRestore()
  })
})
