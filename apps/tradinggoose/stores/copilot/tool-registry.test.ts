import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { ToolArgSchemas, ToolIds } from '@/lib/copilot/registry'
import { MCP_TOOLS_CHANGED_EVENT } from '@/lib/mcp/utils'
import { MONITOR_DATA_CHANGED_EVENT } from '@/app/workspace/[workspaceId]/monitor/components/data/api'
import { environmentKeys } from '@/hooks/queries/environment'
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import { workflowKeys } from '@/hooks/queries/workflows'
import {
  createExecutionContext,
  ensureClientToolInstance,
  getToolInterruptDisplays,
  handleCopilotServerToolSuccess,
  isClientManagedCopilotTool,
  isGatedTool,
  isServerManagedCopilotTool,
} from '@/stores/copilot/tool-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

describe('tool-registry', () => {
  const toolCallId = 'tool-registry-edit-workflow'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('retains all 76 tools, 68 server/8 browser operations and existing limited-access gates', () => {
    const server = ToolIds.options.filter(isServerManagedCopilotTool)
    const client = ToolIds.options.filter(isClientManagedCopilotTool)
    expect(ToolIds.options).toHaveLength(76)
    expect(server).toHaveLength(68)
    expect(client.sort()).toEqual([
      'checkoff_todo',
      'deploy_workflow',
      'gdrive_request_access',
      'mark_todo_in_progress',
      'oauth_request_access',
      'plan',
      'run_workflow',
      'sleep',
    ])
    expect(server.filter(isGatedTool)).toHaveLength(20)
    expect(client.filter(isGatedTool).sort()).toEqual([
      'deploy_workflow',
      'gdrive_request_access',
      'oauth_request_access',
      'run_workflow',
    ])
    for (const name of ToolIds.options) {
      expect(shouldRequireToolApproval('limited', isGatedTool(name))).toBe(isGatedTool(name))
      expect(shouldRequireToolApproval('full', isGatedTool(name))).toBe(false)
    }
  })

  it('keeps workflow edit tools server-managed while exposing review interrupts from metadata', () => {
    expect(ensureClientToolInstance('edit_workflow', toolCallId)).toBeUndefined()
    expect(getToolInterruptDisplays('edit_workflow', toolCallId)).toBeDefined()
    expect(ensureClientToolInstance('edit_workflow_block', toolCallId)).toBeUndefined()
    expect(getToolInterruptDisplays('edit_workflow_block', toolCallId)).toBeDefined()
    expect(ensureClientToolInstance('edit_workflow_variable', toolCallId)).toBeUndefined()
    expect(getToolInterruptDisplays('edit_workflow_variable', toolCallId)).toBeDefined()
  })

  it('carries UI provenance separately and validates genuine original arguments without target injection', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'read_workflow_logs',
      provenance: {
        contextEntityKind: 'workflow',
        contextEntityId: 'wf-current',
        workspaceId: 'workspace',
      },
    })
    expect(context.contextEntityId).toBe('wf-current')
    expect(() => ToolArgSchemas.read_workflow_logs.parse({})).toThrow()
    expect(ToolArgSchemas.read_workflow_logs.parse({ entityId: 'wf-explicit' })).toEqual({
      entityId: 'wf-explicit',
    })
    expect(() => ToolArgSchemas.list_knowledge_bases.parse({})).toThrow()
    expect(ToolArgSchemas.read_environment_variables.parse({ scope: 'personal' })).toEqual({
      scope: 'personal',
    })
  })

  it('classifies gated and non-gated tools explicitly', () => {
    expect(isGatedTool('make_api_request')).toBe(true)
    expect(isGatedTool('edit_workflow')).toBe(false)
    expect(isGatedTool('edit_workflow_block')).toBe(false)
    expect(isGatedTool('edit_workflow_variable')).toBe(false)
    expect(isGatedTool('edit_skill')).toBe(true)
    expect(isGatedTool('edit_indicator')).toBe(true)
    expect(isGatedTool('edit_custom_tool')).toBe(true)
    expect(isGatedTool('edit_mcp_server')).toBe(true)
    expect(isGatedTool('search_listing')).toBe(false)
    expect(isGatedTool('create_watchlist')).toBe(false)
    expect(isGatedTool('edit_watchlist')).toBe(false)
    expect(isGatedTool('rename_watchlist')).toBe(false)
    expect(isGatedTool('create_layout')).toBe(false)
    expect(isGatedTool('edit_layout')).toBe(false)
    expect(isGatedTool('rename_layout')).toBe(false)
    expect(isGatedTool('edit_widget')).toBe(false)
    expect(isGatedTool('list_knowledge_bases')).toBe(false)
    expect(isGatedTool('read_knowledge_base')).toBe(false)
    expect(isGatedTool('create_knowledge_base')).toBe(true)
    expect(isGatedTool('edit_knowledge_base')).toBe(true)
    expect(isGatedTool('rename_knowledge_base')).toBe(true)
    expect(isGatedTool('query_knowledge_base')).toBe(false)
    expect(isGatedTool('edit_monitor')).toBe(true)
    expect(isGatedTool('checkoff_todo')).toBe(false)
    expect(isGatedTool('mark_todo_in_progress')).toBe(false)
    expect(isGatedTool('get_blocks_metadata')).toBe(false)
    expect(isGatedTool('get_agent_accessory_catalog')).toBe(false)
    expect(isGatedTool('unknown_integration_tool')).toBe(true)
  })

  it('keeps saved entity and workflow document tools off the client-staged execution path', () => {
    expect(ensureClientToolInstance('create_workflow', 'create-workflow-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_workflow', 'edit-workflow-tool')).toBeUndefined()
    expect(
      ensureClientToolInstance('edit_workflow_block', 'edit-workflow-block-tool')
    ).toBeUndefined()
    expect(
      ensureClientToolInstance('edit_workflow_variable', 'edit-workflow-variable-tool')
    ).toBeUndefined()
    expect(ensureClientToolInstance('rename_workflow', 'rename-workflow-tool')).toBeUndefined()
    expect(ensureClientToolInstance('read_workflow', 'read-workflow-tool')).toBeUndefined()
    expect(ensureClientToolInstance('list_workflows', 'list-workflows-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_skill', 'edit-skill-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_indicator', 'edit-indicator-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_custom_tool', 'edit-custom-tool-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_mcp_server', 'edit-mcp-server-tool')).toBeUndefined()
    expect(ensureClientToolInstance('list_watchlist', 'list-watchlist-tool')).toBeUndefined()
    expect(ensureClientToolInstance('read_watchlist', 'read-watchlist-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_watchlist', 'edit-watchlist-tool')).toBeUndefined()
    expect(ensureClientToolInstance('list_knowledge_bases', 'list-kb-tool')).toBeUndefined()
    expect(ensureClientToolInstance('read_knowledge_base', 'read-kb-tool')).toBeUndefined()
    expect(ensureClientToolInstance('create_knowledge_base', 'create-kb-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_knowledge_base', 'edit-kb-tool')).toBeUndefined()
    expect(ensureClientToolInstance('rename_knowledge_base', 'rename-kb-tool')).toBeUndefined()
    expect(ensureClientToolInstance('query_knowledge_base', 'query-kb-tool')).toBeUndefined()
    expect(ensureClientToolInstance('list_monitors', 'list-monitors-tool')).toBeUndefined()
    expect(ensureClientToolInstance('read_monitor', 'read-monitor-tool')).toBeUndefined()
    expect(ensureClientToolInstance('edit_monitor', 'edit-monitor-tool')).toBeUndefined()
    expect(
      ensureClientToolInstance('check_deployment_status', 'check-deployment-status-tool')
    ).toBeUndefined()
    expect(
      ensureClientToolInstance('read_block_outputs', 'read-block-outputs-tool')
    ).toBeUndefined()
    expect(
      ensureClientToolInstance(
        'read_block_upstream_references',
        'read-block-upstream-references-tool'
      )
    ).toBeUndefined()
  })

  it('refreshes workflow registry and list query after server-managed workflow mutations', async () => {
    const loadWorkflows = vi
      .spyOn(useWorkflowRegistry.getState(), 'loadWorkflows')
      .mockResolvedValue(undefined)
    const invalidateQueries = vi
      .spyOn(QueryClient.prototype, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await handleCopilotServerToolSuccess('create_workflow', { workspaceId: 'workspace-1' })

    expect(loadWorkflows).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: workflowKeys.list('workspace-1'),
    })
  })

  it('does not invalidate React Query after server-managed skill mutations', async () => {
    const invalidateQueries = vi
      .spyOn(QueryClient.prototype, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await handleCopilotServerToolSuccess('edit_skill', { workspaceId: 'workspace-1' })

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('does not invalidate React Query after server-managed watchlist mutations', async () => {
    const invalidateQueries = vi
      .spyOn(QueryClient.prototype, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await handleCopilotServerToolSuccess('edit_watchlist', { workspaceId: 'workspace-1' })

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('invalidates the selected knowledge base detail tree after server-managed knowledge mutations', async () => {
    const invalidateQueries = vi
      .spyOn(QueryClient.prototype, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await handleCopilotServerToolSuccess('edit_knowledge_base', {
      workspaceId: 'workspace-1',
      entityId: 'kb-1',
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: knowledgeKeys.list('workspace-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: knowledgeKeys.detail('kb-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it('notifies monitor pages after server-managed monitor mutations', async () => {
    class TestCustomEvent<T> {
      type: string
      detail: T | undefined

      constructor(type: string, init?: CustomEventInit<T>) {
        this.type = type
        this.detail = init?.detail
      }
    }
    const dispatchEvent = vi.fn()
    vi.stubGlobal('CustomEvent', TestCustomEvent)
    vi.stubGlobal('window', { dispatchEvent })

    try {
      await handleCopilotServerToolSuccess('edit_monitor', { workspaceId: 'workspace-1' })

      const event = dispatchEvent.mock.calls[0]?.[0] as TestCustomEvent<{ workspaceId: string }>
      expect(event.type).toBe(MONITOR_DATA_CHANGED_EVENT)
      expect(event.detail).toEqual({ workspaceId: 'workspace-1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('notifies MCP tool discovery after server-managed MCP mutations', async () => {
    class TestCustomEvent<T> {
      type: string
      detail: T | undefined

      constructor(type: string, init?: CustomEventInit<T>) {
        this.type = type
        this.detail = init?.detail
      }
    }
    const dispatchEvent = vi.fn()
    vi.stubGlobal('CustomEvent', TestCustomEvent)
    vi.stubGlobal('window', { dispatchEvent })

    try {
      await handleCopilotServerToolSuccess('edit_mcp_server', { workspaceId: 'workspace-1' })

      const event = dispatchEvent.mock.calls[0]?.[0] as TestCustomEvent<{ workspaceId: string }>
      expect(event.type).toBe(MCP_TOOLS_CHANGED_EVENT)
      expect(event.detail).toEqual({ workspaceId: 'workspace-1' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('invalidates the matching environment query after server-managed environment mutations', async () => {
    const invalidateQueries = vi
      .spyOn(QueryClient.prototype, 'invalidateQueries')
      .mockResolvedValue(undefined)
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })

    try {
      await handleCopilotServerToolSuccess('set_environment_variables', {
        success: true,
        scope: 'workspace',
        workspaceId: 'workspace-1',
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: environmentKeys.workspace('workspace-1'),
      })
      expect(invalidateQueries).toHaveBeenCalledTimes(1)
      expect(dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MCP_TOOLS_CHANGED_EVENT,
          detail: { workspaceId: 'workspace-1' },
        })
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
