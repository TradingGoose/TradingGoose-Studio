/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkillsStore } from '@/stores/skills/store'
import { emitSkillEditorState } from '@/widgets/utils/skill-editor-actions'
import { editorSkillWidget } from '@/widgets/widgets/editor_skill'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/skill-dropdown', () => ({
  SkillDropdown: () => <div>skill-dropdown</div>,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const readBlobText = async (blob: Blob) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })

describe('Skill Editor header controls', () => {
  let container: HTMLDivElement
  let root: Root
  let createObjectUrlSpy: ReturnType<typeof vi.fn>
  let revokeObjectUrlSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    useSkillsStore.getState().resetAll()
    useSkillsStore.getState().setSkills('workspace-1', [
      {
        id: 'skill-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'Market Research',
        description: 'Investigate the market.',
        content: 'Use multiple trusted sources.',
        createdAt: '2026-04-06T12:00:00.000Z',
        updatedAt: '2026-04-06T12:00:00.000Z',
      },
    ])

    createObjectUrlSpy = vi.fn(() => 'blob:skill-export')
    revokeObjectUrlSpy = vi.fn()
    clickSpy = vi.fn()

    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrlSpy,
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrlSpy,
    })
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: clickSpy,
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useSkillsStore.getState().resetAll()
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

  it('disables export while the editor is dirty and re-enables it when the editor becomes clean', async () => {
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

    expect(exportButton?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      emitSkillEditorState({
        isDirty: false,
        panelId: 'panel-1',
        widgetKey: 'editor_skill',
      })
    })

    expect(exportButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      emitSkillEditorState({
        isDirty: true,
        panelId: 'panel-1',
        widgetKey: 'editor_skill',
      })
    })

    expect(exportButton?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      emitSkillEditorState({
        isDirty: false,
        panelId: 'panel-1',
        widgetKey: 'editor_skill',
      })
    })

    expect(exportButton?.hasAttribute('disabled')).toBe(false)
  })

  it('downloads the unified export envelope for the selected skill', async () => {
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
      emitSkillEditorState({
        isDirty: false,
        panelId: 'panel-1',
        widgetKey: 'editor_skill',
      })
    })

    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:skill-export')

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob
    const payload = JSON.parse(await readBlobText(blob))

    expect(payload).toMatchObject({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedFrom: 'skillEditor',
      resourceTypes: ['skills'],
      skills: [
        {
          name: 'Market Research',
          description: 'Investigate the market.',
          content: 'Use multiple trusted sources.',
        },
      ],
      workflows: [],
      customTools: [],
      watchlists: [],
      indicators: [],
    })
  })
})
