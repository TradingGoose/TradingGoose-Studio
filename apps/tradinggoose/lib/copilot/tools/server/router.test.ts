import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  KNOWLEDGE_BASE_DOCUMENT_FORMAT,
  WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
} from '@/lib/copilot/document-formats'
import { getCopilotToolPolicy, isWorkspaceAgnosticServerTool } from '@/lib/copilot/tool-policy'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import {
  TG_MERMAID_DOCUMENT_FORMAT,
  WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/document-format'

const toolModuleLoads = vi.fn()

const editWorkflowExecute = vi.fn(async () => ({
  entityKind: 'workflow',
  entityId: 'workflow-123',
  entityName: 'Workflow 1',
  entityDocument: 'flowchart TD\n  n1["Input<br/>id: input1<br/>type: input_trigger"]',
  documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
  workflowState: { blocks: {} },
}))
const readWorkflowLogsExecute = vi.fn(async () => ({
  entries: [],
  totalEntries: 0,
  entityId: 'workflow-123',
  retrievedAt: '2026-08-13T00:00:00.000Z',
  truncated: true,
}))
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
const searchListingExecute = vi.fn(async () => ({ results: [] }))
const docsExecute = vi.fn(
  async (_args?: unknown, _context?: unknown): Promise<any> => ({ results: [] })
)
const docsSelect = vi.fn()
const docsEmbedding = vi.fn()
vi.mock('@tradinggoose/db', () => ({ db: { select: docsSelect } }))
vi.mock('@/lib/embeddings/utils', () => ({ generateSearchEmbedding: docsEmbedding }))
const noopEntityExecute = vi.fn(async () => ({}))

const entityTool = (name: string, execute = noopEntityExecute) => ({ name, execute })

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
    execute: docsExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/listing/search-listing', () => ({
  searchListingServerTool: {
    name: 'search_listing',
    execute: searchListingExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/list-files', () => ({
  listGDriveFilesServerTool: { name: 'list_gdrive_files', execute: listGDriveFilesExecute },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/read-file', () => ({
  readGDriveFileServerTool: { name: 'read_gdrive_file', execute: readGDriveFileExecute },
}))
vi.mock('@/lib/copilot/tools/server/knowledge/knowledge-base', () => {
  toolModuleLoads('knowledge/knowledge-base')
  return {
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
  }
})
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
vi.mock('@/lib/copilot/tools/server/entities/custom-tool', () => ({
  createCustomToolServerTool: entityTool('create_custom_tool'),
  editCustomToolServerTool: entityTool('edit_custom_tool'),
  listCustomToolsServerTool: entityTool('list_custom_tools'),
  readCustomToolServerTool: entityTool('read_custom_tool'),
  renameCustomToolServerTool: entityTool('rename_custom_tool'),
}))
vi.mock('@/lib/copilot/tools/server/entities/indicator', () => ({
  createIndicatorServerTool: entityTool('create_indicator'),
  editIndicatorServerTool: entityTool('edit_indicator'),
  listIndicatorsServerTool: entityTool('list_indicators'),
  readIndicatorServerTool: entityTool('read_indicator'),
  renameIndicatorServerTool: entityTool('rename_indicator'),
}))
vi.mock('@/lib/copilot/tools/server/entities/dashboard-layout', () => ({
  createLayoutServerTool: entityTool('create_layout'),
  listLayoutsServerTool: entityTool('list_layout'),
  readLayoutServerTool: entityTool('read_layout'),
  renameLayoutServerTool: entityTool('rename_layout'),
}))
vi.mock('@/lib/copilot/tools/server/entities/mcp-server', () => ({
  createMcpServerServerTool: entityTool('create_mcp_server'),
  editMcpServerServerTool: entityTool('edit_mcp_server'),
  listMcpServersServerTool: entityTool('list_mcp_servers'),
  readMcpServerServerTool: entityTool('read_mcp_server'),
  renameMcpServerServerTool: entityTool('rename_mcp_server'),
}))
vi.mock('@/lib/copilot/tools/server/entities/skill', () => ({
  createSkillServerTool: entityTool('create_skill'),
  editSkillServerTool: entityTool('edit_skill'),
  listSkillsServerTool: entityTool('list_skills'),
  readSkillServerTool: entityTool('read_skill'),
  renameSkillServerTool: entityTool('rename_skill'),
}))
vi.mock('@/lib/copilot/tools/server/entities/watchlist', () => ({
  createWatchlistServerTool: entityTool('create_watchlist'),
  editWatchlistServerTool: entityTool('edit_watchlist'),
  listWatchlistsServerTool: entityTool('list_watchlist'),
  readWatchlistServerTool: entityTool('read_watchlist'),
  renameWatchlistServerTool: entityTool('rename_watchlist'),
}))
vi.mock('@/lib/copilot/tools/server/entities/workflow', () => {
  toolModuleLoads('entities/workflow')
  return {
    createWorkflowServerTool: entityTool('create_workflow'),
    editWorkflowVariableServerTool: entityTool('edit_workflow_variable'),
    listWorkflowsServerTool: entityTool('list_workflows'),
    readWorkflowServerTool: entityTool('read_workflow'),
    renameWorkflowServerTool: entityTool('rename_workflow'),
  }
})
vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow', () => ({
  editWorkflowServerTool: { name: 'edit_workflow', execute: editWorkflowExecute },
}))
vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow-block', () => ({
  editWorkflowBlockServerTool: entityTool('edit_workflow_block'),
}))
vi.mock('@/lib/copilot/tools/server/workflow/read-workflow-logs', () => ({
  readWorkflowLogsServerTool: {
    name: 'read_workflow_logs',
    execute: readWorkflowLogsExecute,
  },
}))
let ToolArgSchemas: typeof import('@/lib/copilot/registry').ToolArgSchemas
let ToolIds: typeof import('@/lib/copilot/registry').ToolIds
let ToolResultSchemas: typeof import('@/lib/copilot/registry').ToolResultSchemas
let isToolId: typeof import('@/lib/copilot/registry').isToolId
let getMcpServerToolIds: typeof import('@/lib/copilot/tools/server/router').getMcpServerToolIds
let routeExecution: typeof import('@/lib/copilot/tools/server/router').routeExecution

beforeAll(async () => {
  ;({ ToolArgSchemas, ToolIds, ToolResultSchemas, isToolId } = await import(
    '@/lib/copilot/registry'
  ))
  ;({ getMcpServerToolIds, routeExecution } = await import('@/lib/copilot/tools/server/router'))
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
  searchListingExecute.mockClear()
  docsExecute.mockReset().mockResolvedValue({ results: [] })
  docsSelect.mockReset()
  docsEmbedding.mockReset()
  noopEntityExecute.mockClear()
})

describe('copilot contract registry', () => {
  it('discovers tools and executes plan without initializing unrelated implementations', async () => {
    expect(getMcpServerToolIds()).toContain('list_workflows')
    await expect(routeExecution('plan', { objective: 'Inspect' })).resolves.toEqual({
      objective: 'Inspect',
    })
    await expect(routeExecution('read_knowledge_base', {})).rejects.toThrow()
    expect(toolModuleLoads).not.toHaveBeenCalled()
  })

  it('only exposes supported tool ids', () => {
    expect(isToolId('get_available_blocks')).toBe(true)
    expect(isToolId('get_blocks_metadata')).toBe(true)
    expect(isToolId('get_agent_accessory_catalog')).toBe(true)
    expect(isToolId('get_indicator_catalog')).toBe(true)
    expect(isToolId('get_indicator_metadata')).toBe(true)
    expect(isToolId('unknown_tool')).toBe(false)
  })

  it('exposes server tools except direct API requests and Copilot UI tools through MCP', () => {
    const expected = ToolIds.options.filter(
      (name) =>
        getCopilotToolPolicy(name).execution === 'server' &&
        name !== 'make_api_request' &&
        name !== 'plan' &&
        name !== 'checkoff_todo' &&
        name !== 'mark_todo_in_progress'
    )
    expect(getMcpServerToolIds().sort()).toEqual(expected.sort())
  })

  it('requires personal or workspace scope for credential and environment reads', () => {
    for (const toolName of [
      'read_environment_variables',
      'read_credentials',
      'read_oauth_credentials',
    ] as const) {
      const args = ToolArgSchemas[toolName]
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
    const args = ToolArgSchemas.get_available_blocks
    const result = ToolResultSchemas.get_available_blocks

    expect(args.parse({})).toEqual({})
    expect(args.parse({ query: 'OHLCV indicator' })).toEqual({
      query: 'OHLCV indicator',
    })
    expect(args.parse({ category: 'tool' })).toEqual({ category: 'tool' })
    expect(() => args.parse({ unsupported: true })).toThrow()
    expect(result.parse({ blocks: [] })).toEqual({ blocks: [] })
  })

  it('exposes the agent accessory catalog contract', () => {
    const args = ToolArgSchemas.get_agent_accessory_catalog
    const result = ToolResultSchemas.get_agent_accessory_catalog

    expect(args.parse({ workspaceId: 'workspace-123' })).toEqual({
      workspaceId: 'workspace-123',
    })
    expect(result.parse(agentAccessoryCatalogResult)).toEqual(agentAccessoryCatalogResult)
    expect(() => args.parse({})).toThrow()
    expect(() => args.parse({ entityId: 'workflow-123' })).toThrow()
  })

  it('enforces workflow identity in workflow read/list results', () => {
    const workflowReadResult = {
      entityKind: 'workflow',
      entityId: 'workflow-123',
      entityName: 'Workflow 1',
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

    expect(ToolResultSchemas.read_workflow.parse(workflowReadResult)).toEqual(workflowReadResult)

    expect(() =>
      ToolResultSchemas.read_workflow.parse({
        ...workflowReadResult,
        workflowSummary: undefined,
      })
    ).toThrow()

    expect(() =>
      ToolResultSchemas.read_workflow.parse({
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
      ToolResultSchemas.list_workflows.parse({
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

  it('uses one aggregate layout document result for reads and both edit tools', () => {
    const envelope = {
      entityKind: 'dashboard_layout' as const,
      entityId: 'layout-1',
      entityName: 'Layout 1',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
      entityDocument: JSON.stringify({ layout: {}, widgets: {}, colorPairs: { pairs: [] } }),
    }

    expect(ToolResultSchemas.read_layout.parse(envelope)).toEqual(envelope)
    expect(ToolResultSchemas.create_layout.parse({ success: true, ...envelope })).toEqual({
      success: true,
      ...envelope,
    })
    expect(() =>
      ToolResultSchemas.create_layout.parse({
        success: true,
        entityKind: 'dashboard_layout',
        entityId: 'layout-1',
        entityName: 'Layout 1',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
      })
    ).toThrow()
    for (const toolName of ['edit_layout', 'edit_widget'] as const) {
      expect(ToolResultSchemas[toolName].parse({ success: true, ...envelope })).toEqual({
        success: true,
        ...envelope,
      })
    }
  })

  it('accepts the canonical workflow rename result', () => {
    const result = {
      success: true,
      entityKind: 'workflow',
      entityId: 'workflow-123',
      entityName: 'Renamed Workflow',
      workspaceId: 'workspace-123',
    }

    expect(ToolResultSchemas.rename_workflow.parse(result)).toEqual(result)
  })

  it('accepts explicit entity ids on workflow execution tools', () => {
    expect(() => ToolArgSchemas.run_workflow.parse({})).toThrow()
    expect(() => ToolArgSchemas.read_workflow.parse({})).toThrow()
    expect(() => ToolArgSchemas.run_workflow.parse({ entityId: 'workflow-123' })).toThrow()
    expect(
      ToolArgSchemas.run_workflow.parse({
        entityId: 'workflow-123',
        triggerBlockId: 'trigger-1',
      })
    ).toEqual({
      entityId: 'workflow-123',
      triggerBlockId: 'trigger-1',
    })
    expect(
      ToolArgSchemas.edit_workflow_variable.parse({
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

  it('exposes knowledge base document contracts directly', () => {
    const entityDocument =
      '{"description":"","chunkingConfig":{"maxSize":1024,"minSize":1,"overlap":200}}'
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

    expect(ToolArgSchemas.list_knowledge_bases.parse({ workspaceId: 'workspace-123' })).toEqual({
      workspaceId: 'workspace-123',
    })
    expect(
      ToolArgSchemas.create_knowledge_base.parse({
        workspaceId: 'workspace-123',
        name: 'Research',
        entityDocument,
        documentFormat: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
      })
    ).toEqual({
      workspaceId: 'workspace-123',
      name: 'Research',
      entityDocument,
      documentFormat: KNOWLEDGE_BASE_DOCUMENT_FORMAT,
    })
    expect(
      ToolArgSchemas.rename_knowledge_base.parse({
        entityId: 'kb-123',
        name: 'Research',
      })
    ).toEqual({ entityId: 'kb-123', name: 'Research' })
    expect(() => ToolArgSchemas.rename_knowledge_base.parse(mutationArgs)).toThrow()
    expect(ToolResultSchemas.read_knowledge_base.parse(envelope)).toEqual(envelope)
    expect(
      ToolResultSchemas.edit_knowledge_base.parse({
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
      ToolResultSchemas.query_knowledge_base.parse({
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
  it('identifies workspace-agnostic server tools from arbitrary strings', () => {
    expect(isWorkspaceAgnosticServerTool('search_listing')).toBe(true)
    expect(isWorkspaceAgnosticServerTool('search_documentation')).toBe(true)
    expect(isWorkspaceAgnosticServerTool('list_watchlist')).toBe(false)
    expect(isWorkspaceAgnosticServerTool('not_a_tool')).toBe(false)
  })

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

  it('keeps listing content global while retaining the execution workspace', async () => {
    await expect(
      routeExecution(
        'search_listing',
        { query: 'AAPL' },
        {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          contextEntityKind: 'watchlist',
          contextEntityId: 'watchlist-1',
        }
      )
    ).resolves.toEqual({ results: [] })

    expect(searchListingExecute).toHaveBeenCalledWith(
      { query: 'AAPL' },
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        accessLevel: undefined,
        acceptedReviewBaseStateHash: undefined,
        signal: undefined,
      }
    )
  })

  it('routes agent accessory catalog requests through the central contract', async () => {
    const context = {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }

    await expect(
      routeExecution('get_agent_accessory_catalog', { workspaceId: 'workspace-1' }, context)
    ).resolves.toMatchObject({
      tools: expect.any(Array),
      skills: expect.any(Array),
    })

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
      entityName: 'Workflow 1',
      entityDocument: expect.any(String),
      documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
    })

    expect(editWorkflowExecute).toHaveBeenCalledWith(payload, undefined)
  })

  it('preserves entityId when routing workflow logs requests', async () => {
    const payload = {
      entityId: 'workflow-123',
      limit: 5,
    }
    const context = { userId: 'user-1', apiKeyType: 'personal' as const }

    await expect(routeExecution('read_workflow_logs', payload, context)).resolves.toMatchObject({
      entries: expect.any(Array),
      totalEntries: 0,
      entityId: 'workflow-123',
      truncated: true,
    })

    expect(readWorkflowLogsExecute).toHaveBeenCalledWith(payload, context)
  })

  it('rejects workflow log limits above the bounded server contract', async () => {
    await expect(
      routeExecution(
        'read_workflow_logs',
        { entityId: 'workflow-123', limit: 11 },
        { userId: 'user-1' }
      )
    ).rejects.toThrow()

    expect(readWorkflowLogsExecute).not.toHaveBeenCalled()
  })

  it('requires the published workspace argument and rejects a conflicting execution context', async () => {
    const context = { userId: 'user-1', workspaceId: 'workspace-1' }
    const payload = { scope: 'workspace', variables: { API_KEY: 'secret' } }
    await expect(routeExecution('set_environment_variables', payload, context)).rejects.toThrow()
    await expect(
      routeExecution('set_environment_variables', { ...payload, workspaceId: 'other' }, context)
    ).rejects.toThrow('workspaceId does not match execution context')
    expect(setEnvironmentVariablesExecute).not.toHaveBeenCalled()
    await expect(
      routeExecution(
        'set_environment_variables',
        { ...payload, workspaceId: 'workspace-1' },
        context
      )
    ).resolves.toMatchObject({ message: 'ok' })
    expect(setEnvironmentVariablesExecute).toHaveBeenCalledWith(
      { ...payload, workspaceId: 'workspace-1' },
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

it('meters the real global documentation search in its authorized billing workspace', async () => {
  const { searchDocumentationServerTool } = await vi.importActual<
    typeof import('@/lib/copilot/tools/server/docs/search-documentation')
  >('@/lib/copilot/tools/server/docs/search-documentation')
  docsExecute.mockImplementationOnce((args, context) =>
    searchDocumentationServerTool.execute(
      args as Parameters<typeof searchDocumentationServerTool.execute>[0],
      context as Parameters<typeof searchDocumentationServerTool.execute>[1]
    )
  )
  docsSelect
    .mockReturnValueOnce({ from: () => ({ limit: async () => [{ chunkId: 'global-chunk' }] }) })
    .mockReturnValueOnce({
      from: () => ({
        orderBy: () => ({
          limit: async () => [{ similarity: 1, chunkText: 'Global documentation' }],
        }),
      }),
    })
  docsEmbedding.mockResolvedValue({
    embedding: [1, 2],
    model: 'openai/text-embedding-3-small',
    tokens: { prompt: 2, total: 2 },
    usage: { status: 'reported', batches: 1 },
    cost: { status: 'unavailable' },
  })
  const signal = new AbortController().signal
  const result = await routeExecution(
    'search_documentation',
    { query: 'docs' },
    {
      userId: 'actor',
      workspaceId: 'organization-workspace',
      contextEntityKind: 'workflow',
      contextEntityId: 'unrelated-workflow',
      signal,
    }
  )
  expect(docsEmbedding).toHaveBeenCalledExactlyOnceWith('docs', {
    actorUserId: 'actor',
    workspaceId: 'organization-workspace',
    signal,
  })
  expect(result.results).toMatchObject([{ content: 'Global documentation' }])
  expect(docsExecute.mock.calls[0][1]).not.toHaveProperty('contextEntityId')
})

it('preserves only genuine own completed docs facts after global result projection', async () => {
  const facts = {
    model: 'source/embedding',
    tokens: { prompt: 3, total: 3 },
    cost: { status: 'unavailable' as const },
    embeddingUsage: { status: 'reported' as const, batches: 1 },
    generatedFields: ['tokens', 'cost', 'embeddingUsage'],
  }
  docsExecute.mockResolvedValueOnce(
    withInferenceFacts({ results: [], embeddingUsage: { literal: 'removed by schema' } }, facts)
  )
  const result = await routeExecution(
    'search_documentation',
    { query: 'docs' },
    {
      userId: 'actor',
      workspaceId: 'billing-workspace',
      contextEntityKind: 'workflow',
      contextEntityId: 'unrelated-entity',
    }
  )
  expect(Object.fromEntries(Object.entries(result))).toEqual({ results: [] })
  expect(getInferenceFacts(result)).toBe(facts)
  const context = docsExecute.mock.calls[0][1]
  expect(context).toMatchObject({ workspaceId: 'billing-workspace' })
  expect(context).not.toHaveProperty('contextEntityId')
  docsExecute.mockResolvedValueOnce({
    results: [],
    tokens: { total: 9000 },
    embeddingUsage: { status: 'business' },
  })
  expect(
    getInferenceFacts(
      await routeExecution('search_documentation', { query: 'docs' }, { userId: 'actor' })
    )
  ).toBeUndefined()
})
it.each(['abort', 'schema'] as const)(
  'retains completed docs facts when final router %s fails',
  async (failure) => {
    const controller = new AbortController()
    const facts = {
      model: 'source/embedding',
      tokens: { prompt: 3, total: 3 },
      cost: { status: 'unavailable' as const },
      embeddingUsage: { status: 'reported' as const, batches: 1 },
      generatedFields: ['tokens', 'cost', 'embeddingUsage'],
    }
    docsExecute.mockImplementationOnce(async () => {
      if (failure === 'abort') controller.abort()
      return withInferenceFacts({ results: failure === 'schema' ? 'invalid' : [] }, facts)
    })
    const error = await routeExecution(
      'search_documentation',
      { query: 'docs' },
      { userId: 'actor', signal: controller.signal }
    ).catch((error) => error)
    expect(error).toBeInstanceOf(Error)
    expect(getInferenceFacts(error)).toBe(facts)
    expect(getFailureAccounting(error)).toMatchObject({
      tokens: { total: 3 },
      embeddingUsage: { status: 'reported', batches: 1 },
    })
    expect(docsExecute).toHaveBeenCalledOnce()
  }
)
it('keeps an already branded docs Error without readonly Symbol assignment', async () => {
  const facts = { tokens: { total: 3 }, generatedFields: ['tokens'] }
  const failure = withInferenceFacts(
    Object.assign(new Error('known docs failure'), { tokens: { total: 3 } }),
    facts
  )
  docsExecute.mockRejectedValueOnce(failure)
  await expect(
    routeExecution('search_documentation', { query: 'docs' }, { userId: 'actor' })
  ).rejects.toBe(failure)
  expect(getInferenceFacts(failure)).toBe(facts)
})
