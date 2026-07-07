import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { workflowEditorWidget } from './index'

vi.mock('next-intl', () => ({
  useLocale: () => 'es',
  useMessages: () => getPublicCopy('es'),
}))

vi.mock('lucide-react', () => ({
  Workflow: () => <svg />,
}))

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <div>loading</div>,
}))

let mockWorkflowWidgetState: any = {
  resolvedPairColor: 'gray',
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

vi.mock('@/widgets/widgets/editor_workflow/components/workflow-controlbar', () => ({
  WorkflowWidgetControlBar: () => <div>control-bar</div>,
}))

vi.mock('@/widgets/widgets/editor_workflow/components/workflow-toolbar', () => ({
  WorkflowToolbar: () => <div>toolbar</div>,
}))

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-ui-context', () => ({
  WorkflowUIConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/widgets/widgets/editor_workflow/components/workflow-editor-app', () => ({
  __esModule: true,
  default: () => <div>editor-app</div>,
}))

describe('workflowEditorWidget', () => {
  beforeEach(() => {
    mockWorkflowWidgetState = {
      resolvedPairColor: 'gray',
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
      createElement(workflowEditorWidget.component, {
        context: { workspaceId: 'ws-1' },
        widget: { key: 'editor_workflow' },
        panelId: 'panel-1',
      } as any)
    )

    expect(markup).toContain(
      getPublicCopy('es').workspace.widgets.workflowEditor.unableToLoadWorkflows
    )
    expect(markup).not.toContain('unableToLoadWorkflows')
  })
})
