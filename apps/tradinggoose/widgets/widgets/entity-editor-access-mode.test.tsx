import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetComponentProps } from '@/widgets/types'
import { editorCustomToolWidget } from '@/widgets/widgets/editor_custom_tool'
import { EditorIndicatorWidgetBody } from '@/widgets/widgets/editor_indicator/editor-indicator-body'
import { EditorMcpWidgetBody } from '@/widgets/widgets/editor_mcp/editor-mcp-body'
import { EditorSkillWidgetBody } from '@/widgets/widgets/editor_skill/editor-skill-body'

const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())
const mockClearTestResult = vi.hoisted(() => vi.fn())

const entityIds = {
  indicator: 'indicator-1',
  skill: 'skill-1',
  custom_tool: 'custom-tool-1',
  mcp_server: 'mcp-server-1',
} as const

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useMessages: () => ({
    workspace: {
      widgets: {
        indicatorEditor: { body: {} },
        skillEditor: { body: {} },
        customToolEditor: { body: {} },
        mcpEditor: {},
      },
    },
  }),
}))

vi.mock('@/components/ui/loading-agent', () => ({ LoadingAgent: () => <div>Loading</div> }))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: (entityKind: keyof typeof entityIds) => ({
    members: [{ entityId: entityIds[entityKind], entityName: 'Entity' }],
    isLoading: true,
    error: null,
  }),
  useSavedEntityYjsSession: mockUseSavedEntityYjsSession,
}))

vi.mock('@/hooks/use-mcp-tools', () => ({
  useMcpTools: () => ({ refreshTools: vi.fn(), getToolsByServer: () => [] }),
}))

vi.mock('@/hooks/use-mcp-server-test', () => ({
  useMcpServerTest: () => ({
    testResult: null,
    isTestingConnection: false,
    testConnection: vi.fn(),
    clearTestResult: mockClearTestResult,
  }),
}))

vi.mock('@/widgets/utils/indicator-editor-actions', () => ({
  useIndicatorEditorActions: () => {},
}))

vi.mock('@/widgets/utils/skill-editor-actions', () => ({ useSkillEditorActions: () => {} }))
vi.mock('@/widgets/utils/mcp-editor-actions', () => ({ useMcpEditorActions: () => {} }))

const cases: Array<{
  entityKind: keyof typeof entityIds
  params: Record<string, string>
  render: (props: WidgetComponentProps) => ReactNode
}> = [
  {
    entityKind: 'indicator',
    params: { indicatorId: entityIds.indicator },
    render: (props) => <EditorIndicatorWidgetBody {...props} />,
  },
  {
    entityKind: 'skill',
    params: { skillId: entityIds.skill },
    render: (props) => <EditorSkillWidgetBody {...props} />,
  },
  {
    entityKind: 'custom_tool',
    params: { customToolId: entityIds.custom_tool },
    render: (props) => editorCustomToolWidget.component(props),
  },
  {
    entityKind: 'mcp_server',
    params: { mcpServerId: entityIds.mcp_server },
    render: (props) => <EditorMcpWidgetBody {...props} />,
  },
]

describe('saved-entity editor access mode', () => {
  mockUseSavedEntityYjsSession.mockReturnValue({
    doc: null,
    save: vi.fn(),
    isLoading: true,
    error: null,
  })

  it.each(cases)('opens $entityKind in read mode for workspace readers', (testCase) => {
    mockUseSavedEntityYjsSession.mockClear()
    renderToString(
      testCase.render({
        params: testCase.params,
        context: { workspaceId: 'workspace-1', canWrite: false },
      })
    )

    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith(
      testCase.entityKind,
      entityIds[testCase.entityKind],
      'workspace-1',
      null,
      'read'
    )
  })

  it('keeps writer editor sessions writable', () => {
    mockUseSavedEntityYjsSession.mockClear()
    renderToString(
      <EditorIndicatorWidgetBody
        params={{ indicatorId: entityIds.indicator }}
        context={{ workspaceId: 'workspace-1', canWrite: true }}
      />
    )

    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith(
      'indicator',
      entityIds.indicator,
      'workspace-1',
      null,
      'write'
    )
  })
})
