/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { editorCustomToolWidget } from '@/widgets/widgets/editor_custom_tool'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/custom-tool-dropdown', () => ({
  CustomToolDropdown: () => <div>custom-tool-dropdown</div>,
}))

vi.mock('@/stores/dashboard/pair-store', async () => {
  const actual = await vi.importActual<any>('@/stores/dashboard/pair-store')
  return {
    ...actual,
    usePairColorContext: () => null,
    useSetPairColorContext: () => vi.fn(),
  }
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('Custom Tool Editor header controls', () => {
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

  it('renders Export custom tool immediately left of Save custom tool', async () => {
    const header = editorCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_custom_tool',
        params: { customToolId: 'tool-1' },
        pairColor: 'gray',
      } as any,
    } as any)

    await act(async () => {
      root.render(header?.right as ReactNode)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const exportIndex = buttons.findIndex((button) =>
      button.textContent?.includes('Export custom tool')
    )
    const saveIndex = buttons.findIndex((button) =>
      button.textContent?.includes('Save custom tool')
    )

    expect(exportIndex).toBeGreaterThanOrEqual(0)
    expect(saveIndex).toBe(exportIndex + 1)
  })

  it('disables export when no custom tool is selected', async () => {
    const header = editorCustomToolWidget.renderHeader?.({
      context: { workspaceId: 'workspace-1' } as any,
      panelId: 'panel-1',
      widget: {
        key: 'editor_custom_tool',
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
})
