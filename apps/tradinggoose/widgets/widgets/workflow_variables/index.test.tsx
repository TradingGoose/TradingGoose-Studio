import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { workflowVariablesWidget } from './index'

const mockVariablesApp = vi.hoisted(() => vi.fn())

vi.mock('next-intl', () => ({
  useLocale: () => 'es',
  useMessages: () => getPublicCopy('es'),
}))

vi.mock('lucide-react', () => ({
  Braces: () => <svg />,
  Plus: () => <svg />,
}))

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <div>loading</div>,
}))

let mockWorkflowWidgetState: any = {
  resolvedWorkflowId: 'wf-1',
  hasLoadedWorkflows: true,
  loadError: null,
  isLoading: false,
  workflowIds: ['wf-1'],
}

vi.mock('@/widgets/hooks/use-workflow-widget-state', () => ({
  useWorkflowWidgetState: () => mockWorkflowWidgetState,
}))

vi.mock('@/widgets/widgets/components/workflow-dropdown', () => ({
  WorkflowDropdown: () => <div>workflow-dropdown</div>,
}))

vi.mock('./components/workflow-variables-app', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockVariablesApp(props)
    return <div>variables-app</div>
  },
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('workflowVariablesWidget', () => {
  beforeEach(() => {
    mockWorkflowWidgetState = {
      resolvedWorkflowId: 'wf-1',
      hasLoadedWorkflows: true,
      loadError: null,
      isLoading: false,
      workflowIds: ['wf-1'],
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('maps workflow load errors through localized widget copy', () => {
    mockWorkflowWidgetState.loadError = 'unableToLoadWorkflows'

    const markup = renderToStaticMarkup(
      createElement(workflowVariablesWidget.component, {
        context: { workspaceId: 'ws-1' },
        widget: { key: 'workflow_variables' },
        panelId: 'panel-1',
      } as any)
    )

    expect(markup).toContain(
      getPublicCopy('es').workspace.widgets.workflowVariables.unableToLoadWorkflows
    )
    expect(markup).not.toContain('unableToLoadWorkflows')
  })

  it('forwards the runtime channel to the variables app', () => {
    renderToStaticMarkup(
      createElement(workflowVariablesWidget.component, {
        channelId: 'pair-green',
        context: { workspaceId: 'ws-1', canWrite: false },
        params: { workflowId: 'wf-1' },
        panelId: 'panel-1',
      } as any)
    )

    expect(mockVariablesApp).toHaveBeenCalledWith(
      expect.objectContaining({ canWrite: false, channelId: 'pair-green', workflowId: 'wf-1' })
    )
  })
})
