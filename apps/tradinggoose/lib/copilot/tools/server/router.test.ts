import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KNOWLEDGE_BASE_DOCUMENT_FORMAT,
  WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import {
  TG_MERMAID_DOCUMENT_FORMAT,
  WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/document-format'

const editWorkflowExecute = vi.fn(async () => ({
  entityKind: 'workflow',
  entityId: 'workflow-123',
  entityDocument: 'flowchart TD\n  n1["Input<br/>id: input1<br/>type: input_trigger"]',
  documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
  workflowState: { blocks: {} },
}))
const readWorkflowLogsExecute = vi.fn(async () => ({ entries: [] }))
const getIndicatorCatalogExecute = vi.fn(async () => ({
  sections: [],
  items: [],
  count: 0,
}))
const getIndicatorMetadataExecute = vi.fn(async () => ({
  items: [],
  missingIds: [],
}))
const agentAccessoryCatalogResult = { tools: [], skills: [] }
const getAgentAccessoryCatalogExecute = vi.fn(async () => agentAccessoryCatalogResult)
const listGDriveFilesExecute = vi.fn(async () => ({ files: [] }))
const readGDriveFileExecute = vi.fn(async () => ({ content: '' }))
const readCredentialsExecute = vi.fn(async () => ({
  oauth: {
    connected: { credentials: [], total: 0 },
    notConnected: { services: [], total: 0 },
  },
  environment: { variableNames: [], count: 0 },
}))
const readEnvironmentVariablesExecute = vi.fn(async () => ({
  variableNames: [],
  personalVariableNames: [],
  workspaceVariableNames: [],
  conflicts: [],
  count: 0,
}))
const readOAuthCredentialsExecute = vi.fn(async () => ({ credentials: [], total: 0 }))
const setEnvironmentVariablesExecute = vi.fn(async () => ({
  success: true,
  scope: 'workspace',
  message: 'ok',
}))

vi.mock('@/lib/copilot/tools/server/blocks/get-available-blocks', () => ({
  getAvailableBlocksServerTool: {
    name: 'get_available_blocks',
    execute: vi.fn(async () => ({ blocks: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata', () => ({
  getBlocksMetadataServerTool: {
    name: 'get_blocks_metadata',
    execute: vi.fn(async () => ({ metadata: {} })),
  },
}))
vi.mock('@/lib/copilot/tools/server/agent/get-agent-accessory-catalog', () => ({
  getAgentAccessoryCatalogServerTool: {
    name: 'get_agent_accessory_catalog',
    execute: getAgentAccessoryCatalogExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/indicators/get-indicator-catalog', () => ({
  getIndicatorCatalogServerTool: {
    name: 'get_indicator_catalog',
    execute: getIndicatorCatalogExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/indicators/get-indicator-metadata', () => ({
  getIndicatorMetadataServerTool: {
    name: 'get_indicator_metadata',
    execute: getIndicatorMetadataExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/docs/search-documentation', () => ({
  searchDocumentationServerTool: {
    name: 'search_documentation',
    execute: vi.fn(async () => ({ results: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/list-files', () => ({
  listGDriveFilesServerTool: { name: 'list_gdrive_files', execute: listGDriveFilesExecute },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/read-file', () => ({
  readGDriveFileServerTool: { name: 'read_gdrive_file', execute: readGDriveFileExecute },
}))
vi.mock('@/lib/copilot/tools/server/knowledge/knowledge-base', () => ({
  listKnowledgeBasesServerTool: {
    name: 'list_knowledge_bases',
    execute: vi.fn(async () => ({ entityKind: 'knowledge_base', entities: [], count: 0 })),
  },
  readKnowledgeBaseServerTool: {
    name: 'read_knowledge_base',
    execute: vi.fn(),
  },
  createKnowledgeBaseServerTool: {
    name: 'create_knowledge_base',
    execute: vi.fn(),
  },
  editKnowledgeBaseServerTool: {
    name: 'edit_knowledge_base',
    execute: vi.fn(),
  },
  renameKnowledgeBaseServerTool: {
    name: 'rename_knowledge_base',
    execute: vi.fn(),
  },
  queryKnowledgeBaseServerTool: {
    name: 'query_knowledge_base',
    execute: vi.fn(),
  },
}))
vi.mock('@/lib/copilot/tools/server/other/make-api-request', () => ({
  makeApiRequestServerTool: {
    name: 'make_api_request',
    execute: vi.fn(async () => ({ success: true })),
  },
}))
vi.mock('@/lib/copilot/tools/server/other/search-online', () => ({
  searchOnlineServerTool: { name: 'search_online', execute: vi.fn(async () => ({ results: [] })) },
}))
vi.mock('@/lib/copilot/tools/server/user/read-credentials', () => ({
  readCredentialsServerTool: { name: 'read_credentials', execute: readCredentialsExecute },
}))
vi.mock('@/lib/copilot/tools/server/user/read-environment-variables', () => ({
  readEnvironmentVariablesServerTool: {
    name: 'read_environment_variables',
    execute: readEnvironmentVariablesExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/user/read-oauth-credentials', () => ({
  readOAuthCredentialsServerTool: {
    name: 'read_oauth_credentials',
    execute: readOAuthCredentialsExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/user/set-environment-variables', () => ({
  setEnvironmentVariablesServerTool: {
    name: 'set_environment_variables',
    execute: setEnvironmentVariablesExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow', () => ({
  editWorkflowServerTool: { name: 'edit_workflow', execute: editWorkflowExecute },
}))
vi.mock('@/lib/copilot/tools/server/workflow/read-workflow-logs', () => ({
  readWorkflowLogsServerTool: {
    name: 'read_workflow_logs',
    execute: readWorkflowLogsExecute,
  },
}))

let getToolContract: typeof import('@/lib/copilot/registry').getToolContract
let isToolId: typeof import('@/lib/copilot/registry').isToolId
let routeExecution: typeof import('@/lib/copilot/tools/server/router').routeExecution

beforeAll(async () => {
  ;({ getToolContract, isToolId } = await import('@/lib/copilot/registry'))
  ;({ routeExecution } = await import('@/lib/copilot/tools/server/router'))
}, 30000)

beforeEach(() => {
  editWorkflowExecute.mockClear()
  readWorkflowLogsExecute.mockClear()
  getAgentAccessoryCatalogExecute.mockClear()
  getIndicatorCatalogExecute.mockClear()
  getIndicatorMetadataExecute.mockClear()
  listGDriveFilesExecute.mockClear()
  readGDriveFileExecute.mockClear()
  readCredentialsExecute.mockClear()
  readEnvironmentVariablesExecute.mockClear()
  readOAuthCredentialsExecute.mockClear()
  setEnvironmentVariablesExecute.mockClear()
})

describe('copilot contract registry', () => {
  it('only exposes supported tool ids', () => {
    expect(isToolId('get_available_blocks')).toBe(true)
    expect(isToolId('get_blocks_metadata')).toBe(true)
    expect(isToolId('get_agent_accessory_catalog')).toBe(true)
    expect(isToolId('get_indicator_catalog')).toBe(true)
    expect(isToolId('get_indicator_metadata')).toBe(true)
    expect(isToolId('unknown_tool')).toBe(false)
    expect(getToolContract('unknown_tool')).toBeUndefined()
  })

  it('requires personal or workspace scope for credential and environment reads', () => {
    for (const toolName of [
      'read_environment_variables',
      'read_credentials',
      'read_oauth_credentials',
    ] as const) {
      const args = getToolContract(toolName)?.args
      expect(args?.parse({ scope: 'personal' })).toEqual({
        scope: 'personal',
      })
      expect(args?.parse({ scope: 'workspace', workspaceId: 'workspace-123' })).toEqual({
        scope: 'workspace',
        workspaceId: 'workspace-123',
      })
      expect(() => args?.parse({ scope: 'workflow', entityId: 'workflow-123' })).toThrow()
      expect(() => args?.parse({})).toThrow()
    }
  })

  it('reuses the shared block schemas in the central contract', () => {
    const contract = getToolContract('get_available_blocks')

    expect(contract?.args.parse({})).toEqual({})
    expect(contract?.args.parse({ query: 'OHLCV indicator' })).toEqual({
      query: 'OHLCV indicator',
    })
    expect(contract?.args.parse({ category: 'tool' })).toEqual({ category: 'tool' })
    expect(() => contract?.args.parse({ unsupported: true })).toThrow()
    expect(contract?.result.parse({ blocks: [] })).toEqual({ blocks: [] })
  })

  it('exposes the agent accessory catalog contract', () => {
    const contract = getToolContract('get_agent_accessory_catalog')

    expect(contract?.args.parse({ workspaceId: 'workspace-123' })).toEqual({
      workspaceId: 'workspace-123',
    })
    expect(contract?.result.parse(agentAccessoryCatalogResult)).toEqual(agentAccessoryCatalogResult)
    expect(() => contract?.args.parse({})).toThrow()
    expect(() => contract?.args.parse({ entityId: 'workflow-123' })).toThrow()
  })

  it('enforces workflow identity in workflow read/list results', () => {
    const workflowReadResult = {
      entityKind: 'workflow',
      entityId: 'workflow-123',
      entityDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
      workflowVariableDocumentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
      workflowVariableDocument: '{"variables":[]}',
      workflowSummary: {
        blocks: [],
        edges: [],
        connectionIssues: [],
      },
    }

    expect(getToolContract('read_workflow')?.result.parse(workflowReadResult)).toEqual(
      workflowReadResult
    )

    expect(() =>
      getToolContract('read_workflow')?.result.parse({
        ...workflowReadResult,
        workflowSummary: undefined,
      })
    ).toThrow()

    expect(() =>
      getToolContract('read_workflow')?.result.parse({
        entityKind: 'workflow',
        entityId: 'workflow-123',
        entityDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
        documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
        workflowVariableDocumentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
        workflowVariableDocument: '{"variables":[]}',
        workflowSummary: {
          blocks: [
            {
              blockId: 'trigger',
              blockType: 'input_trigger',
              blockName: 'Input Form',
              subBlockIds: ['ticker'],
            },
          ],
        },
      })
    ).toThrow()

    expect(
      getToolContract('list_workflows')?.result.parse({
        entityKind: 'workflow',
        entities: [{ entityId: 'workflow-123', entityName: 'Workflow 1' }],
        count: 1,
      })
    ).toEqual({
      entityKind: 'workflow',
      entities: [{ entityId: 'workflow-123', entityName: 'Workflow 1' }],
      count: 1,
    })
  })

  it('accepts explicit entity ids on workflow execution tools', () => {
    expect(() => getToolContract('run_workflow')?.args.parse({})).toThrow()
    expect(() => getToolContract('read_workflow')?.args.parse({})).toThrow()
    expect(() =>
      getToolContract('run_workflow')?.args.parse({ entityId: 'workflow-123' })
    ).toThrow()
    expect(
      getToolContract('run_workflow')?.args.parse({
        entityId: 'workflow-123',
        triggerBlockId: 'trigger-1',
      })
    ).toEqual({
      entityId: 'workflow-123',
      triggerBlockId: 'trigger-1',
    })
    expect(
      getToolContract('edit_workflow_variable')?.args.parse({
        entityId: 'workflow-123',
        entityDocument: '{"variables":[]}',
        documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
      })
    ).toEqual({
      entityId: 'workflow-123',
      entityDocument: '{"variables":[]}',
      documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
    })
  })

  it('exposes knowledge base document contracts without the legacy operation wrapper', () => {
    const entityDocument =
      '{"name":"Research","description":"","chunkingConfig":{"maxSize":1024,"minSize":1,"overlap":200}}'
    const mutationArgs = {
      entityId: 'kb-123',
      entityDocument,
      documentFormat: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
    }
    const envelope = {
      entityKind: 'knowledge_base',
      entityId: 'kb-123',
      entityName: 'Research',
      workspaceId: 'workspace-123',
      documentFormat: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
      entityDocument,
      docCount: 0,
      tokenCount: 0,
      embeddingModel: 'text-embedding-3-small',
      embeddingDimension: 1536,
    }

    expect(
      getToolContract('list_knowledge_bases')?.args.parse({ workspaceId: 'workspace-123' })
    ).toEqual({ workspaceId: 'workspace-123' })
    expect(
      getToolContract('create_knowledge_base')?.args.parse({
        workspaceId: 'workspace-123',
        entityDocument,
        documentFormat: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
      })
    ).toEqual({
      workspaceId: 'workspace-123',
      entityDocument,
      documentFormat: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
    })
    expect(getToolContract('rename_knowledge_base')?.args.parse(mutationArgs)).toEqual(mutationArgs)
    expect(() =>
      getToolContract('rename_knowledge_base')?.args.parse({ entityId: 'kb-123', name: 'Research' })
    ).toThrow()
    expect(getToolContract('read_knowledge_base')?.result.parse(envelope)).toEqual(envelope)
    expect(
      getToolContract('edit_knowledge_base')?.result.parse({
        ...envelope,
        requiresReview: true,
        success: true,
        preview: {
          documentDiff: {
            before: entityDocument,
            after: entityDocument,
          },
        },
      })
    ).toMatchObject({
      entityKind: 'knowledge_base',
      entityId: 'kb-123',
      requiresReview: true,
      success: true,
    })
    expect(
      getToolContract('query_knowledge_base')?.result.parse({
        entityKind: 'knowledge_base',
        entityId: 'kb-123',
        entityName: 'Research',
        query: 'risk',
        topK: 5,
        totalResults: 1,
        results: [{ documentId: 'doc-1', content: 'risk note', chunkIndex: 0, similarity: 0.9 }],
      })
    ).toMatchObject({ entityId: 'kb-123', totalResults: 1 })
  })
})

describe('routeExecution', () => {
  it('stops aborted server tool execution before invoking the tool', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      routeExecution(
        'read_environment_variables',
        {},
        {
          userId: 'user-1',
          signal: controller.signal,
        }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(readEnvironmentVariablesExecute).not.toHaveBeenCalled()
  })

  it('validates request payloads through the central contract before execution', async () => {
    await expect(routeExecution('get_blocks_metadata', {})).rejects.toThrow()
  })

  it('validates server tool results through the central contract', async () => {
    await expect(routeExecution('get_available_blocks', {})).resolves.toMatchObject({
      blocks: expect.any(Array),
    })
  })

  it('routes indicator catalog requests through the central contract', async () => {
    await expect(
      routeExecution('get_indicator_catalog', { query: 'input', includeItems: true })
    ).resolves.toMatchObject({
      sections: expect.any(Array),
      items: expect.any(Array),
      count: expect.any(Number),
    })

    expect(getIndicatorCatalogExecute).toHaveBeenCalledWith(
      { query: 'input', includeItems: true },
      undefined
    )
  })

  it('routes agent accessory catalog requests through the central contract', async () => {
    const context = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }

    await expect(routeExecution('get_agent_accessory_catalog', {}, context)).resolves.toMatchObject(
      {
        tools: expect.any(Array),
        skills: expect.any(Array),
      }
    )

    expect(getAgentAccessoryCatalogExecute).toHaveBeenCalledWith(
      { workspaceId: 'workspace-1' },
      context
    )
  })

  it('routes indicator metadata requests through the central contract', async () => {
    await expect(
      routeExecution('get_indicator_metadata', { targetIds: ['input.int'] })
    ).resolves.toMatchObject({
      items: expect.any(Array),
      missingIds: expect.any(Array),
    })

    expect(getIndicatorMetadataExecute).toHaveBeenCalledWith(
      { targetIds: ['input.int'] },
      undefined
    )
  })

  it('preserves workflow edit entity fields when routing workflow tools', async () => {
    const payload = {
      entityDocument: 'flowchart TD\n  n1["Input<br/>id: input1<br/>type: input_trigger"]',
      entityId: 'workflow-123',
    }

    await expect(routeExecution('edit_workflow', payload)).resolves.toMatchObject({
      entityKind: 'workflow',
      entityId: 'workflow-123',
      entityDocument: expect.any(String),
      documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
    })

    expect(editWorkflowExecute).toHaveBeenCalledWith(payload, undefined)
  })

  it('preserves entityId when routing workflow logs requests', async () => {
    const payload = {
      entityId: 'workflow-123',
      limit: 5,
      includeDetails: false,
    }

    await expect(routeExecution('read_workflow_logs', payload)).resolves.toMatchObject({
      entries: expect.any(Array),
    })

    expect(readWorkflowLogsExecute).toHaveBeenCalledWith(payload, undefined)
  })

  it('injects hosted workspace context for workspace-scoped writes', async () => {
    const context = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }

    await expect(
      routeExecution(
        'set_environment_variables',
        { scope: 'workspace', variables: { API_KEY: 'secret' } },
        context
      )
    ).resolves.toMatchObject({
      message: 'ok',
    })

    expect(setEnvironmentVariablesExecute).toHaveBeenCalledWith(
      { scope: 'workspace', variables: { API_KEY: 'secret' }, workspaceId: 'workspace-1' },
      context
    )
  })

  it.each([
    {
      toolName: 'read_environment_variables',
      payload: { scope: 'workspace', workspaceId: 'workspace-123' },
      execute: readEnvironmentVariablesExecute,
    },
    {
      toolName: 'set_environment_variables',
      payload: {
        scope: 'workspace',
        workspaceId: 'workspace-123',
        variables: { API_KEY: 'secret' },
      },
      execute: setEnvironmentVariablesExecute,
    },
    {
      toolName: 'read_credentials',
      payload: { scope: 'workspace', workspaceId: 'workspace-123' },
      execute: readCredentialsExecute,
    },
    {
      toolName: 'list_gdrive_files',
      payload: {
        workspaceId: 'workspace-123',
        credentialId: 'credential-1',
        search_query: 'report',
        num_results: 3,
      },
      expectedArgs: {
        workspaceId: 'workspace-123',
        credentialId: 'credential-1',
        search_query: 'report',
        num_results: 3,
      },
      execute: listGDriveFilesExecute,
    },
    {
      toolName: 'read_gdrive_file',
      payload: {
        workspaceId: 'workspace-123',
        credentialId: 'credential-1',
        fileId: 'file-1',
        type: 'doc',
      },
      execute: readGDriveFileExecute,
    },
    {
      toolName: 'read_oauth_credentials',
      payload: { scope: 'workspace', workspaceId: 'workspace-123' },
      execute: readOAuthCredentialsExecute,
    },
    {
      toolName: 'read_environment_variables',
      payload: { scope: 'personal' },
      execute: readEnvironmentVariablesExecute,
    },
    {
      toolName: 'read_credentials',
      payload: { scope: 'personal' },
      execute: readCredentialsExecute,
    },
    {
      toolName: 'read_oauth_credentials',
      payload: { scope: 'personal' },
      execute: readOAuthCredentialsExecute,
    },
  ])(
    'preserves explicit args when routing $toolName',
    async ({ toolName, payload, expectedArgs, execute }) => {
      const workspaceId =
        typeof (payload as { workspaceId?: unknown }).workspaceId === 'string'
          ? (payload as { workspaceId: string }).workspaceId
          : undefined
      const context = workspaceId ? { userId: 'user-1' } : undefined

      await expect(routeExecution(toolName, payload, context)).resolves.toBeDefined()

      expect(execute).toHaveBeenCalledWith(
        expectedArgs ?? payload,
        workspaceId ? { userId: 'user-1', workspaceId } : undefined
      )
    }
  )
})
