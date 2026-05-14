import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockResolveServerWorkflowScope = vi.hoisted(() => vi.fn())
const mockListCustomTools = vi.hoisted(() => vi.fn())

vi.mock('@/lib/copilot/tools/server/base-tool', () => ({
  resolveServerWorkflowScope: mockResolveServerWorkflowScope,
}))

vi.mock('@/lib/copilot/tools/server/blocks/block-mermaid-catalog', () => ({
  listWorkflowBlockCatalogItems: vi.fn(async () => []),
}))

vi.mock('@/lib/custom-tools/operations', () => ({
  listCustomTools: mockListCustomTools,
}))

vi.mock('@/lib/mcp/service', () => ({
  mcpService: {
    discoverTools: vi.fn(async () => []),
  },
}))

vi.mock('@/lib/skills/operations', () => ({
  listSkills: vi.fn(async () => []),
}))

vi.mock('@/blocks/registry', () => ({
  registry: {},
}))

vi.mock('@/tools/registry', () => ({
  tools: {},
}))

import { getAgentAccessoryCatalogServerTool } from './get-agent-accessory-catalog'

describe('getAgentAccessoryCatalogServerTool', () => {
  beforeEach(() => {
    mockResolveServerWorkflowScope.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
    mockListCustomTools.mockResolvedValue([
      {
        id: 'custom-tool-1',
        title: 'Weather Tool',
        code: 'return { ok: true }',
        schema: {
          function: {
            name: 'weather_tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      },
    ])
  })

  it('emits executable custom tool IDs from canonical custom tool database IDs', async () => {
    const result = await getAgentAccessoryCatalogServerTool.execute(
      { workflowId: 'workflow-1' },
      { userId: 'user-1' }
    )

    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]).toMatchObject({
      id: 'custom:custom-tool-1',
      source: 'custom_tool',
      value: {
        toolId: 'custom_custom-tool-1',
      },
    })
  })
})
