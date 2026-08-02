/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SKILL_EDITOR_ACTION_EVENT, type SkillEditorActionEventDetail } from '@/widgets/events'
import { editorSkillWidget } from '@/widgets/widgets/editor_skill'

const entityListState = vi.hoisted(() => ({ ids: ['skill-1'] }))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({
    members: entityListState.ids.map((entityId) => ({ entityId })),
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true }),
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

vi.mock('@/widgets/widgets/components/skill-dropdown', () => ({
  SkillDropdown: () => <div>skill-dropdown</div>,
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: vi.fn(),
    patchWidgetLinkedParams: vi.fn(),
  }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('Skill Editor header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    entityListState.ids = ['skill-1']
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders Export skill immediately left of Save skill', async () => {
    const header = editorSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_skill',
        params: { skillId: 'skill-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[0]?.textContent).toContain('Export skill')
    expect(buttons[1]?.textContent).toContain('Save skill')
  })

  it('disables export when no skill is selected', async () => {
    const header = editorSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_skill',
        params: {},
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[0]?.hasAttribute('disabled')).toBe(true)
  })

  it('emits export for the selected skill', async () => {
    const actionSpy = vi.fn()
    const handler = (event: Event) => {
      actionSpy((event as CustomEvent<SkillEditorActionEventDetail>).detail)
    }
    window.addEventListener(SKILL_EDITOR_ACTION_EVENT, handler)
    const header = editorSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_skill',
        params: { skillId: 'skill-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const exportButton = buttons[0]

    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(actionSpy).toHaveBeenCalledWith({
      action: 'export',
      entityId: 'skill-1',
      panelId: 'panel-1',
      widgetKey: 'editor_skill',
    })
    window.removeEventListener(SKILL_EDITOR_ACTION_EVENT, handler)
  })

  it('emits save for the selected skill', async () => {
    const actionSpy = vi.fn()
    const handler = (event: Event) => {
      actionSpy((event as CustomEvent<SkillEditorActionEventDetail>).detail)
    }
    window.addEventListener(SKILL_EDITOR_ACTION_EVENT, handler)
    const header = editorSkillWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_skill',
        params: { skillId: 'skill-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const saveButton = buttons[1]

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(actionSpy).toHaveBeenCalledWith({
      action: 'save',
      entityId: 'skill-1',
      panelId: 'panel-1',
      widgetKey: 'editor_skill',
    })
    window.removeEventListener(SKILL_EDITOR_ACTION_EVENT, handler)
  })

  it('disables actions when the selected skill leaves the shared list', async () => {
    const renderActions = () =>
      editorSkillWidget.renderHeader?.({
        context: { workspaceId: 'workspace-1' } as any,
        panelId: 'panel-1',
        widget: {
          key: 'editor_skill',
          params: { skillId: 'skill-1' },
          pairColor: 'gray',
        } as any,
      } as any)?.right as ReactNode

    await act(async () => root.render(renderActions()))
    expect(container.querySelectorAll('button')[0]).not.toBeDisabled()

    entityListState.ids = []
    await act(async () => root.render(renderActions()))
    expect(container.querySelectorAll('button')[0]).toBeDisabled()
  })
})
