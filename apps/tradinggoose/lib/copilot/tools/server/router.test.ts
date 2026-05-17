import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/studio-workflow-mermaid'

const editWorkflowExecute = vi.fn(async () => ({
  entityKind: 'workflow',
  entityId: 'workflow-123',
  entityDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
  documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
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
const readEnvironmentVariablesExecute = vi.fn(async () => ({ variableNames: [], count: 0 }))
const readOAuthCredentialsExecute = vi.fn(async () => ({ credentials: [], total: 0 }))
const setEnvironmentVariablesExecute = vi.fn(async () => ({ message: 'ok' }))

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
  knowledgeBaseServerTool: {
    name: 'knowledge_base',
    execute: vi.fn(async () => ({ results: [] })),
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

    expect(contract?.args.parse({})).toEqual({})
    expect(contract?.args.parse({ workflowId: 'workflow-123' })).toEqual({
      workflowId: 'workflow-123',
    })
    expect(contract?.result.parse(agentAccessoryCatalogResult)).toEqual(agentAccessoryCatalogResult)
    expect(() => contract?.args.parse({ workspaceId: 'workspace-123' })).toThrow()
  })

  it('enforces workflow identity in workflow read/list results', () => {
    const workflowReadResult = {
      entityKind: 'workflow',
      entityId: 'workflow-123',
      entityDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
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
        entityDocument:
          'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
        documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
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

  it('accepts explicit workflow ids on workflow execution tools', () => {
    expect(() => getToolContract('run_workflow')?.args.parse({})).toThrow()
    expect(() => getToolContract('read_workflow')?.args.parse({})).toThrow()
    expect(getToolContract('run_workflow')?.args.parse({ workflowId: 'workflow-123' })).toEqual({
      workflowId: 'workflow-123',
    })
    expect(
      getToolContract('set_workflow_variables')?.args.parse({
        workflowId: 'workflow-123',
        operations: [],
      })
    ).toEqual({
      workflowId: 'workflow-123',
      operations: [],
    })
  })
})

describe('routeExecution', () => {
  it('stops aborted server tool execution before invoking the tool', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      routeExecution('read_environment_variables', {}, {
        userId: 'user-1',
        signal: controller.signal,
      })
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
      contextWorkflowId: 'workflow-current',
    }

    await expect(routeExecution('get_agent_accessory_catalog', {}, context)).resolves.toMatchObject(
      {
        tools: expect.any(Array),
        skills: expect.any(Array),
      }
    )

    expect(getAgentAccessoryCatalogExecute).toHaveBeenCalledWith({}, context)
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

  it('preserves workflow edit context fields when routing workflow tools', async () => {
    const payload = {
      workflowDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
      workflowId: 'workflow-123',
      currentWorkflowState: '{"blocks":{}}',
    }

    await expect(routeExecution('edit_workflow', payload)).resolves.toMatchObject({
      entityKind: 'workflow',
      entityId: 'workflow-123',
      entityDocument: expect.any(String),
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
    })

    expect(editWorkflowExecute).toHaveBeenCalledWith(payload, undefined)
  })

  it('preserves workflowId when routing workflow logs requests', async () => {
    const payload = {
      workflowId: 'workflow-123',
      limit: 5,
      includeDetails: false,
    }

    await expect(routeExecution('read_workflow_logs', payload)).resolves.toMatchObject({
      entries: expect.any(Array),
    })

    expect(readWorkflowLogsExecute).toHaveBeenCalledWith(payload, undefined)
  })

  it('forwards ambient workflow context separately from raw tool args', async () => {
    const context = {
      userId: 'user-1',
      contextWorkflowId: 'workflow-current',
    }

    await expect(routeExecution('read_environment_variables', {}, context)).resolves.toMatchObject({
      variableNames: expect.any(Array),
      count: expect.any(Number),
    })

    expect(readEnvironmentVariablesExecute).toHaveBeenCalledWith({}, context)
  })

  it.each([
    {
      toolName: 'read_environment_variables',
      payload: { workflowId: 'workflow-123' },
      execute: readEnvironmentVariablesExecute,
    },
    {
      toolName: 'set_environment_variables',
      payload: { workflowId: 'workflow-123', variables: { API_KEY: 'secret' } },
      execute: setEnvironmentVariablesExecute,
    },
    {
      toolName: 'read_credentials',
      payload: { workflowId: 'workflow-123' },
      execute: readCredentialsExecute,
    },
    {
      toolName: 'list_gdrive_files',
      payload: {
        workflowId: 'workflow-123',
        credentialId: 'credential-1',
        userId: 'spoofed-user',
        search_query: 'report',
        num_results: 3,
      },
      expectedArgs: {
        workflowId: 'workflow-123',
        credentialId: 'credential-1',
        search_query: 'report',
        num_results: 3,
      },
      execute: listGDriveFilesExecute,
    },
    {
      toolName: 'read_gdrive_file',
      payload: {
        workflowId: 'workflow-123',
        credentialId: 'credential-1',
        fileId: 'file-1',
        type: 'doc',
      },
      execute: readGDriveFileExecute,
    },
    {
      toolName: 'read_oauth_credentials',
      payload: { workflowId: 'workflow-123' },
      execute: readOAuthCredentialsExecute,
    },
  ])(
    'preserves workflowId when routing $toolName',
    async ({ toolName, payload, expectedArgs, execute }) => {
      await expect(routeExecution(toolName, payload)).resolves.toBeDefined()

      expect(execute).toHaveBeenCalledWith(expectedArgs ?? payload, undefined)
    }
  )
})
