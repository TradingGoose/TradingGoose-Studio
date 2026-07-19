/** @vitest-environment jsdom */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { getFieldsMap, seedEntitySession } from '@/lib/yjs/entity-session'
import type { WidgetComponentProps } from '@/widgets/types'
import { editorCustomToolWidget } from '@/widgets/widgets/editor_custom_tool'
import { EditorIndicatorWidgetBody } from '@/widgets/widgets/editor_indicator/editor-indicator-body'
import { EditorMcpWidgetBody } from '@/widgets/widgets/editor_mcp/editor-mcp-body'
import { EditorSkillWidgetBody } from '@/widgets/widgets/editor_skill/editor-skill-body'

const mockUseSavedEntityYjsSession = vi.hoisted(() => vi.fn())
const mockUseEntityList = vi.hoisted(() => vi.fn())
const mockClearTestResult = vi.hoisted(() => vi.fn())
const mockTestConnection = vi.hoisted(() => vi.fn())
const mockRefreshTools = vi.hoisted(() => vi.fn())
const mockRenameSavedEntity = vi.hoisted(() => vi.fn())
const mockMcpEditorActions = vi.hoisted(() => vi.fn())
const mockMcpForm = vi.hoisted(() => ({ setFormData: null as null | ((next: any) => void) }))
const mockPermissions = vi.hoisted(() => ({ canEdit: true, isLoading: false }))

const entityIds = {
  indicator: 'indicator-1',
  skill: 'skill-1',
  custom_tool: 'custom-tool-1',
  mcp_server: 'mcp-server-1',
} as const

vi.mock('next-intl', () => ({
  createTranslator:
    ({ messages }: { messages: { value: string } }) =>
    () =>
      messages.value,
  useLocale: () => 'en',
  useMessages: () => ({
    workspace: {
      widgets: {
        indicatorEditor: { body: {} },
        skillEditor: { body: {} },
        customToolEditor: { body: {} },
        mcpEditor: {
          connected: 'Connected',
          disconnected: 'Disconnected',
          error: 'Error',
          unnamedServer: 'Unnamed server',
          failedToRefreshMcpServer: 'Refresh failed',
          failedToSaveMcpServer: 'Save failed',
          serverNameRequired: 'Name required',
          tools: 'Tools',
          toolCount: '{count} tools',
          noToolsDiscovered: 'No tools',
        },
      },
    },
  }),
}))

vi.mock('@/components/ui/loading-agent', () => ({ LoadingAgent: () => <div>Loading</div> }))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: mockUseEntityList,
  useSavedEntityYjsSession: mockUseSavedEntityYjsSession,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => mockPermissions,
}))

vi.mock('@/hooks/use-mcp-tools', () => ({
  useMcpTools: () => ({ refreshTools: mockRefreshTools, getToolsByServer: () => [] }),
}))

vi.mock('@/hooks/use-mcp-server-test', () => ({
  useMcpServerTest: () => ({
    testResult: null,
    isTestingConnection: false,
    testConnection: mockTestConnection,
    clearTestResult: mockClearTestResult,
  }),
}))

vi.mock('@/lib/saved-entities/actions', () => ({
  renameSavedEntityAction: mockRenameSavedEntity,
}))

vi.mock('@/widgets/widgets/_shared/mcp/components/mcp-server-form', () => ({
  McpServerForm: ({ setFormData }: { setFormData: (next: any) => void }) => {
    mockMcpForm.setFormData = setFormData
    return <div>mcp-form</div>
  },
}))

vi.mock('@/widgets/utils/indicator-editor-actions', () => ({
  useIndicatorEditorActions: () => {},
}))

vi.mock('@/widgets/utils/skill-editor-actions', () => ({ useSkillEditorActions: () => {} }))
vi.mock('@/widgets/utils/mcp-editor-actions', () => ({
  useMcpEditorActions: (actions: unknown) => mockMcpEditorActions(actions),
}))

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

const renderEditor = (testCase = cases[0]!) =>
  renderToString(
    testCase.render({
      channelId: 'entity-editor-panel-1',
      params: testCase.params,
      context: { workspaceId: 'workspace-1' },
    })
  )

describe('saved-entity editor access mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    mockMcpForm.setFormData = null
    mockPermissions.canEdit = true
    mockPermissions.isLoading = false
    mockUseEntityList.mockImplementation((entityKind: keyof typeof entityIds) => ({
      members: [{ entityId: entityIds[entityKind], entityName: 'Entity' }],
      isLoading: true,
      error: null,
    }))
    mockUseSavedEntityYjsSession.mockReturnValue({
      doc: null,
      save: vi.fn(),
      isLoading: true,
      error: null,
    })
  })

  it.each(cases)('opens $entityKind in read mode for workspace readers', (testCase) => {
    mockUseSavedEntityYjsSession.mockClear()
    mockPermissions.canEdit = false
    renderEditor(testCase)

    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith(
      testCase.entityKind,
      entityIds[testCase.entityKind],
      'workspace-1',
      null,
      'read'
    )
  })

  it('opens a writer session only after local permissions resolve', () => {
    mockUseSavedEntityYjsSession.mockClear()
    renderEditor()

    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith(
      'indicator',
      entityIds.indicator,
      'workspace-1',
      null,
      'write'
    )
    mockUseSavedEntityYjsSession.mockClear()
    mockPermissions.isLoading = true
    renderEditor()

    expect(mockUseSavedEntityYjsSession).toHaveBeenCalledWith('indicator', null, null, null, 'read')
  })

  it('makes retained MCP writer callbacks harmless after a read-only downgrade', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'mcp_server',
      payload: {
        description: 'Original',
        transport: 'http',
        url: 'https://mcp.example.com',
        headers: {},
        command: '',
        args: [],
        env: {},
        timeout: 30000,
        retries: 3,
        enabled: true,
      },
    })
    const save = vi.fn().mockResolvedValue(undefined)
    mockUseEntityList.mockReturnValue({
      members: [{ entityId: entityIds.mcp_server, entityName: 'Entity' }],
      isLoading: false,
      error: null,
    })
    mockUseSavedEntityYjsSession.mockReturnValue({ doc, save, isLoading: false, error: null })
    const renderEditor = () => (
      <EditorMcpWidgetBody
        channelId='mcp-editor-panel-1'
        params={{ mcpServerId: entityIds.mcp_server }}
        context={{ workspaceId: 'workspace-1' }}
        panelId='panel-1'
        widget={{ key: 'editor_mcp', pairColor: 'gray', params: null }}
      />
    )

    await act(async () => root.render(renderEditor()))
    await act(async () => {
      mockMcpForm.setFormData?.((current: Record<string, unknown>) => ({
        ...current,
        name: 'Renamed',
        description: 'Writer description',
      }))
    })
    const retainedSetFormData = mockMcpForm.setFormData!
    const retainedActions = mockMcpEditorActions.mock.calls.at(-1)?.[0] as {
      save: () => Promise<void>
      refresh: () => Promise<void>
      reset: () => void
      test: () => Promise<void>
    }
    const baseline = getFieldsMap(doc).toJSON()

    mockPermissions.canEdit = false
    await act(async () => root.render(renderEditor()))
    const clearCount = mockClearTestResult.mock.calls.length
    await act(async () => {
      retainedSetFormData((current: Record<string, unknown>) => ({
        ...current,
        description: 'Forbidden',
      }))
      retainedActions.reset()
      await retainedActions.test()
      await retainedActions.refresh()
      await retainedActions.save()
    })

    expect(getFieldsMap(doc).toJSON()).toEqual(baseline)
    expect(mockClearTestResult).toHaveBeenCalledTimes(clearCount)
    expect(mockRenameSavedEntity).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(mockTestConnection).not.toHaveBeenCalled()
    expect(mockRefreshTools).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    container.remove()
    doc.destroy()
  })
})
