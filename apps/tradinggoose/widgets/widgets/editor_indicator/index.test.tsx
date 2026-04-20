/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIndicatorsStore } from '@/stores/indicators/store'
import { emitIndicatorEditorState } from '@/widgets/utils/indicator-editor-actions'
import { editorIndicatorWidget } from '@/widgets/widgets/editor_indicator'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/pine-indicator-dropdown', () => ({
  IndicatorDropdown: () => <div>indicator-dropdown</div>,
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

describe('Indicator Editor header controls', () => {
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

    useIndicatorsStore.getState().resetAll()
    useIndicatorsStore.getState().setIndicators('workspace-1', [
      {
        id: 'indicator-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        name: 'RSI Export Example',
        color: '#3972F6',
        pineCode: "indicator('RSI Export Example')",
        inputMeta: {
          Length: {
            title: 'Length',
            type: 'int',
            defval: 14,
          },
        },
        createdAt: '2026-04-08T15:30:00.000Z',
        updatedAt: '2026-04-08T15:30:00.000Z',
      },
    ])

    createObjectUrlSpy = vi.fn(() => 'blob:indicator-export')
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
    useIndicatorsStore.getState().resetAll()
  })

  it('renders Export indicator immediately left of Save indicator', async () => {
    const header = editorIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_indicator',
        params: { pineIndicatorId: 'indicator-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[1]?.textContent).toContain('Export indicator')
    expect(buttons[2]?.textContent).toContain('Save indicator')
  })

  it('disables export when no indicator is selected', async () => {
    const header = editorIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_indicator',
        params: {},
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons[1]?.hasAttribute('disabled')).toBe(true)
  })

  it('disables export while the editor is dirty and re-enables it when the editor becomes clean', async () => {
    const header = editorIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_indicator',
        params: { pineIndicatorId: 'indicator-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const exportButton = buttons[1]

    expect(exportButton?.hasAttribute('disabled')).toBe(true)

    await act(async () => {
      emitIndicatorEditorState({
        isDirty: false,
        panelId: 'panel-1',
        widgetKey: 'editor_indicator',
      })
    })

    expect(exportButton?.hasAttribute('disabled')).toBe(false)

    await act(async () => {
      emitIndicatorEditorState({
        isDirty: true,
        panelId: 'panel-1',
        widgetKey: 'editor_indicator',
      })
    })

    expect(exportButton?.hasAttribute('disabled')).toBe(true)
  })

  it('downloads the unified export envelope for the selected indicator', async () => {
    const header = editorIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_indicator',
        params: { pineIndicatorId: 'indicator-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const exportButton = buttons[1]

    await act(async () => {
      emitIndicatorEditorState({
        isDirty: false,
        panelId: 'panel-1',
        widgetKey: 'editor_indicator',
      })
    })

    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:indicator-export')

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob
    const payload = JSON.parse(await readBlobText(blob))

    expect(payload).toMatchObject({
      version: '1',
      fileType: 'tradingGooseExport',
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
          inputMeta: {
            Length: {
              title: 'Length',
              type: 'int',
              defval: 14,
            },
          },
        },
      ],
    })
  })
})
