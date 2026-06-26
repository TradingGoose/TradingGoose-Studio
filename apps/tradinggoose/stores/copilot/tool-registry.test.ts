import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getQueryClient } from '@/app/query-provider'
import { MONITOR_DATA_CHANGED_EVENT } from '@/app/workspace/[workspaceId]/monitor/components/data/api'
import { environmentKeys } from '@/hooks/queries/environment'
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import { skillsKeys } from '@/hooks/queries/skills'
import { workflowKeys } from '@/hooks/queries/workflows'
import {
  createExecutionContext,
  ensureClientToolInstance,
  getToolInterruptDisplays,
  handleCopilotServerToolSuccess,
  isGatedTool,
  prepareCopilotToolArgs,
} from '@/stores/copilot/tool-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

describe('tool-registry', () => {
  const toolCallId = 'tool-registry-edit-workflow'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps workflow edit tools server-managed while exposing review interrupts from metadata', () => {
    expect(ensureClientToolInstance('edit_workflow', toolCallId)).toBeUndefined()
    expect(getToolInterruptDisplays('edit_workflow', toolCallId)).toBeDefined()
    expect(ensureClientToolInstance('edit_workflow_block', toolCallId)).toBeUndefined()
    expect(getToolInterruptDisplays('edit_workflow_block', toolCallId)).toBeDefined()
    expect(ensureClientToolInstance('edit_workflow_variable', toolCallId)).toBeUndefined()
    expect(getToolInterruptDisplays('edit_workflow_variable', toolCallId)).toBeDefined()
  })

  it('requires explicit target args instead of injecting ambient entity context', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'read_workflow_logs',
      provenance: { contextEntityKind: 'workflow', contextEntityId: 'wf-current' },
    })

    expect(context.contextEntityKind).toBe('workflow')
    expect(context.contextEntityId).toBe('wf-current')
    expect(() => prepareCopilotToolArgs('read_workflow_logs', {}, context)).toThrow()
    expect(
      prepareCopilotToolArgs('read_workflow_logs', { entityId: 'wf-explicit' }, context)
    ).toEqual({ entityId: 'wf-explicit' })
  })

  it('injects hosted workspace context for workspace-targeted GDrive tools', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'read_gdrive_file',
      provenance: { workspaceId: 'workspace-1' },
    })

    expect(
      prepareCopilotToolArgs(
        'read_gdrive_file',
        { credentialId: 'credential-1', fileId: 'file-1', type: 'doc' },
        context
      )
    ).toEqual({
      workspaceId: 'workspace-1',
      credentialId: 'credential-1',
      fileId: 'file-1',
      type: 'doc',
    })
  })

  it('requires workspace context for workspace-targeted GDrive tools', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'read_gdrive_file',
      provenance: {},
    })

    expect(() =>
      prepareCopilotToolArgs(
        'read_gdrive_file',
        { credentialId: 'credential-1', fileId: 'file-1', type: 'doc' },
        context
      )
    ).toThrow()
  })

  it('injects hosted workspace context for workspace-scoped environment and credential tools', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'set_environment_variables',
      provenance: { workspaceId: 'workspace-1' },
    })

    expect(
      prepareCopilotToolArgs(
        'set_environment_variables',
        { scope: 'workspace', variables: { API_KEY: 'secret' } },
        context
      )
    ).toEqual({
      scope: 'workspace',
      workspaceId: 'workspace-1',
      variables: { API_KEY: 'secret' },
    })

    for (const toolName of [
      'read_environment_variables',
      'read_credentials',
      'read_oauth_credentials',
    ] as const) {
      expect(prepareCopilotToolArgs(toolName, { scope: 'workspace' }, context)).toEqual({
        scope: 'workspace',
        workspaceId: 'workspace-1',
      })
    }

    expect(() =>
      prepareCopilotToolArgs(
        'set_environment_variables',
        { variables: { API_KEY: 'secret' } },
        context
      )
    ).toThrow()
  })

  it('preserves personal scope for environment and credential tools in workspace context', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'read_environment_variables',
      provenance: { workspaceId: 'workspace-1' },
    })

    for (const toolName of [
      'read_environment_variables',
      'read_credentials',
      'read_oauth_credentials',
    ] as const) {
      expect(prepareCopilotToolArgs(toolName, { scope: 'personal' }, context)).toEqual({
        scope: 'personal',
      })
    }
  })

  it('injects hosted workspace context into workspace-targeted knowledge base tools', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'list_knowledge_bases',
      provenance: { workspaceId: 'workspace-1' },
    })

    expect(prepareCopilotToolArgs('list_knowledge_bases', {}, context)).toEqual({
      workspaceId: 'workspace-1',
    })

    expect(
      prepareCopilotToolArgs(
        'create_knowledge_base',
        {
          entityDocument:
            '{"name":"Research","description":"","chunkingConfig":{"maxSize":1024,"minSize":1,"overlap":200}}',
          documentFormat: 'tg-knowledge-base-document-v1',
        },
        context
      )
    ).toEqual({
      workspaceId: 'workspace-1',
      entityDocument:
        '{"name":"Research","description":"","chunkingConfig":{"maxSize":1024,"minSize":1,"overlap":200}}',
      documentFormat: 'tg-knowledge-base-document-v1',
    })
  })

  it('requires workspaceId for local knowledge base list tools', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'list_knowledge_bases',
      provenance: {},
    })

    expect(() => prepareCopilotToolArgs('list_knowledge_bases', {}, context)).toThrow()
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
      .spyOn(getQueryClient(), 'invalidateQueries')
      .mockResolvedValue(undefined)

    await handleCopilotServerToolSuccess('create_workflow', { workspaceId: 'workspace-1' })

    expect(loadWorkflows).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: workflowKeys.list('workspace-1'),
    })
  })

  it('invalidates saved-entity list queries after server-managed saved-entity mutations', async () => {
    const invalidateQueries = vi
      .spyOn(getQueryClient(), 'invalidateQueries')
      .mockResolvedValue(undefined)

    await handleCopilotServerToolSuccess('edit_skill', { workspaceId: 'workspace-1' })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: skillsKeys.list('workspace-1'),
    })
  })

  it('invalidates the selected knowledge base detail tree after server-managed knowledge mutations', async () => {
    const invalidateQueries = vi
      .spyOn(getQueryClient(), 'invalidateQueries')
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

  it('invalidates the matching environment query after server-managed environment mutations', async () => {
    const invalidateQueries = vi
      .spyOn(getQueryClient(), 'invalidateQueries')
      .mockResolvedValue(undefined)

    await handleCopilotServerToolSuccess('set_environment_variables', {
      success: true,
      scope: 'workspace',
      workspaceId: 'workspace-1',
    })

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: environmentKeys.workspace('workspace-1'),
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })
})
