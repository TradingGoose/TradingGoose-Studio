/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INDICATOR_EDITOR_ACTION_EVENT,
  type IndicatorEditorActionEventDetail,
} from '@/widgets/events'
import { editorIndicatorWidget } from '@/widgets/widgets/editor_indicator'

const mockPatchWidgetParams = vi.fn()
const mockPatchWidgetLinkedParams = vi.fn()

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/pine-indicator-dropdown', () => ({
  IndicatorDropdown: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button type='button' onClick={() => onChange(['indicator-next'])}>
      indicator-dropdown
    </button>
  ),
}))

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: (...args: unknown[]) => mockPatchWidgetParams(...args),
    patchWidgetLinkedParams: (...args: unknown[]) => mockPatchWidgetLinkedParams(...args),
  }),
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('Indicator Editor header controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('renders Export indicator immediately left of Save indicator', async () => {
    const header = editorIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_indicator',
        params: { indicatorId: 'indicator-1' },
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

  it.each(['gray', 'red'] as const)(
    'routes %s selections through the linked-parameter callback',
    async (pairColor) => {
      const header = editorIndicatorWidget.renderHeader?.({
        context: { workspaceId: 'workspace-1' } as any,
        panelId: 'panel-1',
        widget: {
          key: 'editor_indicator',
          params: { indicatorId: 'indicator-1' },
          pairColor,
        } as any,
      } as any)

      await act(async () => {
        root.render(header?.center as ReactNode)
      })
      await act(async () => {
        container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(mockPatchWidgetLinkedParams).toHaveBeenCalledWith({
        indicatorId: 'indicator-next',
      })
      expect(mockPatchWidgetParams).not.toHaveBeenCalled()
    }
  )

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

  it('emits verify, export, and save actions for the selected indicator', async () => {
    const actionSpy = vi.fn()
    const handler = (event: Event) => {
      actionSpy((event as CustomEvent<IndicatorEditorActionEventDetail>).detail)
    }
    window.addEventListener(INDICATOR_EDITOR_ACTION_EVENT, handler)
    const header = editorIndicatorWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_indicator',
        params: { indicatorId: 'indicator-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))

    await act(async () => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      buttons[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(actionSpy).toHaveBeenNthCalledWith(1, {
      action: 'verify',
      panelId: 'panel-1',
      widgetKey: 'editor_indicator',
    })
    expect(actionSpy).toHaveBeenNthCalledWith(2, {
      action: 'export',
      panelId: 'panel-1',
      widgetKey: 'editor_indicator',
    })
    expect(actionSpy).toHaveBeenNthCalledWith(3, {
      action: 'save',
      panelId: 'panel-1',
      widgetKey: 'editor_indicator',
    })
    window.removeEventListener(INDICATOR_EDITOR_ACTION_EVENT, handler)
  })
})
