import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/studio-workflow-mermaid'

const editWorkflowExecute = vi.fn(async () => ({
  entityKind: 'workflow',
  entityId: 'workflow-123',
  entityDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
  workflowId: 'workflow-123',
  documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
  workflowDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
  workflowState: { blocks: {} },
}))
const getWorkflowConsoleExecute = vi.fn(async () => ({ entries: [] }))
const getIndicatorCatalogExecute = vi.fn(async () => ({
  sections: [],
  items: [],
  count: 0,
}))
const getIndicatorMetadataExecute = vi.fn(async () => ({
  items: [],
  missingIds: [],
}))
const listGDriveFilesExecute = vi.fn(async () => ({ files: [] }))
const readGDriveFileExecute = vi.fn(async () => ({ content: '' }))
const getCredentialsExecute = vi.fn(async () => ({
  oauth: {
    connected: { credentials: [], total: 0 },
    notConnected: { services: [], total: 0 },
  },
  environment: { variableNames: [], count: 0 },
}))
const getEnvironmentVariablesExecute = vi.fn(async () => ({ variableNames: [], count: 0 }))
const getOAuthCredentialsExecute = vi.fn(async () => ({ credentials: [], total: 0 }))
const setEnvironmentVariablesExecute = vi.fn(async () => ({ message: 'ok' }))

vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-and-tools', () => ({
  getBlocksAndToolsServerTool: {
    name: 'get_blocks_and_tools',
    execute: vi.fn(async () => ({ blocks: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool', () => ({
  getBlocksMetadataServerTool: {
    name: 'get_blocks_metadata',
    execute: vi.fn(async () => ({ metadata: {} })),
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
vi.mock('@/lib/copilot/tools/server/blocks/get-trigger-blocks', () => ({
  getTriggerBlocksServerTool: {
    name: 'get_trigger_blocks',
    execute: vi.fn(async () => ({ blocks: [] })),
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
vi.mock('@/lib/copilot/tools/server/user/get-credentials', () => ({
  getCredentialsServerTool: { name: 'get_credentials', execute: getCredentialsExecute },
}))
vi.mock('@/lib/copilot/tools/server/user/get-environment-variables', () => ({
  getEnvironmentVariablesServerTool: {
    name: 'get_environment_variables',
    execute: getEnvironmentVariablesExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/user/get-oauth-credentials', () => ({
  getOAuthCredentialsServerTool: {
    name: 'get_oauth_credentials',
    execute: getOAuthCredentialsExecute,
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
vi.mock('@/lib/copilot/tools/server/workflow/get-workflow-console', () => ({
  getWorkflowConsoleServerTool: {
    name: 'get_workflow_console',
    execute: getWorkflowConsoleExecute,
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
  getWorkflowConsoleExecute.mockClear()
  getIndicatorCatalogExecute.mockClear()
  getIndicatorMetadataExecute.mockClear()
  listGDriveFilesExecute.mockClear()
  readGDriveFileExecute.mockClear()
  getCredentialsExecute.mockClear()
  getEnvironmentVariablesExecute.mockClear()
  getOAuthCredentialsExecute.mockClear()
  setEnvironmentVariablesExecute.mockClear()
})

describe('copilot contract registry', () => {
  it('only exposes supported tool ids', () => {
    expect(isToolId('get_blocks_and_tools')).toBe(true)
    expect(isToolId('get_blocks_metadata')).toBe(true)
    expect(isToolId('get_indicator_catalog')).toBe(true)
    expect(isToolId('get_indicator_metadata')).toBe(true)
    expect(isToolId('get_block_options')).toBe(false)
    expect(isToolId('get_block_config')).toBe(false)
    expect(isToolId('get_block_best_practices')).toBe(false)
    expect(getToolContract('get_block_best_practices')).toBeUndefined()
  })

  it('reuses the shared block schemas in the central contract', () => {
    const contract = getToolContract('get_blocks_and_tools')

    expect(contract?.args.parse({})).toEqual({})
    expect(contract?.args.parse({ query: 'OHLCV indicator' })).toEqual({
      query: 'OHLCV indicator',
    })
    expect(contract?.result.parse({ blocks: [] })).toEqual({ blocks: [] })
  })

  it('enforces workflow identity in workflow read/list results', () => {
    expect(() =>
      getToolContract('get_user_workflow')?.result.parse({
        workflowId: 'workflow-123',
        workflowDocument:
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
      getToolContract('list_user_workflows')?.result.parse({
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
    expect(() => getToolContract('get_user_workflow')?.args.parse({})).toThrow()
    expect(getToolContract('run_workflow')?.args.parse({ workflowId: 'workflow-123' })).toEqual({
      workflowId: 'workflow-123',
    })
    expect(
      getToolContract('set_global_workflow_variables')?.args.parse({
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
  it('validates request payloads through the central contract before execution', async () => {
    await expect(routeExecution('get_blocks_metadata', {})).rejects.toThrow()
  })

  it('validates server tool results through the central contract', async () => {
    await expect(routeExecution('get_blocks_and_tools', {})).resolves.toMatchObject({
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
      workflowDocument: expect.any(String),
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
    })

    expect(editWorkflowExecute).toHaveBeenCalledWith(payload, undefined)
  })

  it('preserves workflowId when routing workflow console requests', async () => {
    const payload = {
      workflowId: 'workflow-123',
      limit: 5,
      includeDetails: false,
    }

    await expect(routeExecution('get_workflow_console', payload)).resolves.toMatchObject({
      entries: expect.any(Array),
    })

    expect(getWorkflowConsoleExecute).toHaveBeenCalledWith(payload, undefined)
  })

  it('forwards ambient workflow context separately from raw tool args', async () => {
    const context = {
      userId: 'user-1',
      contextWorkflowId: 'workflow-current',
    }

    await expect(routeExecution('get_environment_variables', {}, context)).resolves.toMatchObject({
      variableNames: expect.any(Array),
      count: expect.any(Number),
    })

    expect(getEnvironmentVariablesExecute).toHaveBeenCalledWith({}, context)
  })

  it.each([
    {
      toolName: 'get_environment_variables',
      payload: { workflowId: 'workflow-123' },
      execute: getEnvironmentVariablesExecute,
    },
    {
      toolName: 'set_environment_variables',
      payload: { workflowId: 'workflow-123', variables: { API_KEY: 'secret' } },
      execute: setEnvironmentVariablesExecute,
    },
    {
      toolName: 'get_credentials',
      payload: { workflowId: 'workflow-123' },
      execute: getCredentialsExecute,
    },
    {
      toolName: 'list_gdrive_files',
      payload: {
        workflowId: 'workflow-123',
        userId: 'spoofed-user',
        search_query: 'report',
        num_results: 3,
      },
      expectedArgs: { workflowId: 'workflow-123', search_query: 'report', num_results: 3 },
      execute: listGDriveFilesExecute,
    },
    {
      toolName: 'read_gdrive_file',
      payload: { workflowId: 'workflow-123', fileId: 'file-1', type: 'doc' },
      execute: readGDriveFileExecute,
    },
    {
      toolName: 'get_oauth_credentials',
      payload: { workflowId: 'workflow-123' },
      execute: getOAuthCredentialsExecute,
    },
  ])(
    'preserves workflowId when routing $toolName',
    async ({ toolName, payload, expectedArgs, execute }) => {
      await expect(routeExecution(toolName, payload)).resolves.toBeDefined()

      expect(execute).toHaveBeenCalledWith(expectedArgs ?? payload, undefined)
    }
  )
})
