import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/studio-workflow-mermaid'

const editWorkflowExecute = vi.fn(async () => ({
  documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
  workflowDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
  workflowState: { blocks: {} },
}))
const getWorkflowConsoleExecute = vi.fn(async () => ({ entries: [] }))

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@tradinggoose/db/schema', () => ({
  workflow: {
    id: 'workflow.id',
    userId: 'workflow.user_id',
    workspaceId: 'workflow.workspace_id',
    folderId: 'workflow.folder_id',
    name: 'workflow.name',
    description: 'workflow.description',
    color: 'workflow.color',
    lastSynced: 'workflow.last_synced',
    createdAt: 'workflow.created_at',
    updatedAt: 'workflow.updated_at',
    isDeployed: 'workflow.is_deployed',
    collaborators: 'workflow.collaborators',
    runCount: 'workflow.run_count',
    variables: 'workflow.variables',
    isPublished: 'workflow.is_published',
    marketplaceData: 'workflow.marketplace_data',
  },
}))
vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  createPermissionError: vi.fn(),
  verifyWorkflowAccess: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/server/blocks/get-block-config', () => ({
  getBlockConfigServerTool: { name: 'get_block_config', execute: vi.fn(async () => ({})) },
}))
vi.mock('@/lib/copilot/tools/server/blocks/get-block-options', () => ({
  getBlockOptionsServerTool: { name: 'get_block_options', execute: vi.fn(async () => ({})) },
}))
vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-and-tools', () => ({
  getBlocksAndToolsServerTool: {
    name: 'get_blocks_and_tools',
    execute: vi.fn(async () => ({ blocks: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool', () => ({
  getBlocksMetadataServerTool: {
    name: 'get_blocks_metadata',
    execute: vi.fn(async () => ({ blocks: [] })),
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
  listGDriveFilesServerTool: { name: 'list_gdrive_files', execute: vi.fn(async () => ({ files: [] })) },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/read-file', () => ({
  readGDriveFileServerTool: { name: 'read_gdrive_file', execute: vi.fn(async () => ({ content: '' })) },
}))
vi.mock('@/lib/copilot/tools/server/knowledge/knowledge-base', () => ({
  knowledgeBaseServerTool: { name: 'knowledge_base', execute: vi.fn(async () => ({ results: [] })) },
}))
vi.mock('@/lib/copilot/tools/server/other/make-api-request', () => ({
  makeApiRequestServerTool: { name: 'make_api_request', execute: vi.fn(async () => ({ success: true })) },
}))
vi.mock('@/lib/copilot/tools/server/other/search-online', () => ({
  searchOnlineServerTool: { name: 'search_online', execute: vi.fn(async () => ({ results: [] })) },
}))
vi.mock('@/lib/copilot/tools/server/user/get-credentials', () => ({
  getCredentialsServerTool: { name: 'get_credentials', execute: vi.fn(async () => ({ credentials: [] })) },
}))
vi.mock('@/lib/copilot/tools/server/user/get-environment-variables', () => ({
  getEnvironmentVariablesServerTool: {
    name: 'get_environment_variables',
    execute: vi.fn(async () => ({ variables: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/user/get-oauth-credentials', () => ({
  getOAuthCredentialsServerTool: {
    name: 'get_oauth_credentials',
    execute: vi.fn(async () => ({ credentials: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/user/set-environment-variables', () => ({
  setEnvironmentVariablesServerTool: {
    name: 'set_environment_variables',
    execute: vi.fn(async () => ({ success: true })),
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
})

beforeEach(() => {
  editWorkflowExecute.mockClear()
  getWorkflowConsoleExecute.mockClear()
})

describe('copilot contract registry', () => {
  it('only exposes supported tool ids', () => {
    expect(isToolId('get_blocks_and_tools')).toBe(true)
    expect(isToolId('get_block_best_practices')).toBe(false)
    expect(isToolId('get_edit_workflow_examples')).toBe(false)
    expect(getToolContract('get_block_best_practices')).toBeUndefined()
  })

  it('reuses the shared block schemas in the central contract', () => {
    const contract = getToolContract('get_blocks_and_tools')

    expect(contract?.args.parse({})).toEqual({})
    expect(contract?.result.parse({ blocks: [] })).toEqual({ blocks: [] })
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

  it('preserves workflow edit context fields when routing workflow tools', async () => {
    const payload = {
      workflowDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
      workflowId: 'workflow-123',
      currentWorkflowState: '{"blocks":{}}',
    }

    await expect(routeExecution('edit_workflow', payload)).resolves.toMatchObject({
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
})
