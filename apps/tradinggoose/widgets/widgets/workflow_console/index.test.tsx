import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { workflowConsoleWidget } from './index'

const mockConsoleApp = vi.hoisted(() => vi.fn())

vi.mock('@/i18n/workspace-widget-hooks', () => ({
  useWorkflowConsoleMessages: () => ({}),
  useWorkflowDropdownMessages: () => ({}),
}))

vi.mock('@/widgets/hooks/use-workflow-widget-state', () => ({
  useWorkflowWidgetState: () => ({
    resolvedWorkflowId: 'wf-1',
    hasLoadedWorkflows: true,
    loadError: null,
    isLoading: false,
    workflowIds: ['wf-1'],
  }),
}))

vi.mock('./components/workflow-console-app', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockConsoleApp(props)
    return <div>console-app</div>
  },
}))

describe('workflowConsoleWidget', () => {
  it('opens the workflow console in read mode for workspace readers', () => {
    renderToStaticMarkup(
      createElement(workflowConsoleWidget.component, {
        context: { workspaceId: 'ws-1', canWrite: false },
        widget: { key: 'workflow_console' },
        panelId: 'panel-1',
      } as any)
    )

    expect(mockConsoleApp).toHaveBeenCalledWith(expect.objectContaining({ accessMode: 'read' }))
  })
})
