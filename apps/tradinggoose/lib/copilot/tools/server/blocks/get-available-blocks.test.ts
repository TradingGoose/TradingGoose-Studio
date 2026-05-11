import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetOAuthProviderAvailability = vi.hoisted(() => vi.fn())

vi.mock('@/lib/oauth/oauth.server', () => ({
  getOAuthProviderAvailability: mockGetOAuthProviderAvailability,
}))

vi.mock('@/lib/workflows/block-mermaid-contract', () => ({
  buildWorkflowBlockMermaidContract: (blockType: string) => {
    const renderKind =
      blockType === 'loop'
        ? 'loop_container'
        : blockType === 'parallel'
          ? 'parallel_container'
          : 'standard'

    return {
      renderKind,
      requiresSubgraph: renderKind !== 'standard',
      childrenPlacement: renderKind === 'standard' ? 'none' : 'inside_container',
      canonicalCommentPrefixes: {
        workflow: 'TG_WORKFLOW:',
        block: 'TG_BLOCK:',
        edge: 'TG_EDGE:',
      },
    }
  },
  buildWorkflowBlockMermaidShape: ({
    blockType,
    blockName,
  }: {
    blockType: string
    blockName: string
  }) => {
    const renderKind =
      blockType === 'loop'
        ? 'loop_container'
        : blockType === 'parallel'
          ? 'parallel_container'
          : 'standard'

    return {
      mermaidContract: {
        renderKind,
        requiresSubgraph: renderKind !== 'standard',
        childrenPlacement: renderKind === 'standard' ? 'none' : 'inside_container',
        canonicalCommentPrefixes: {
          workflow: 'TG_WORKFLOW:',
          block: 'TG_BLOCK:',
          edge: 'TG_EDGE:',
        },
      },
      mermaidExamples: {
        minimalDocument: `${blockName} minimal`,
        connectedDocument: `${blockName} connected`,
      },
    }
  },
}))

vi.mock('@/blocks/registry', () => {
  const baseBlock = {
    description: 'Mock block description',
    category: 'blocks',
    subBlocks: [],
    outputs: {},
  }

  const registry = {
    agent: {
      ...baseBlock,
      name: 'Agent',
    },
    function: {
      ...baseBlock,
      name: 'Function',
      longDescription: 'Run custom indicator logic.',
    },
    historical_data: {
      ...baseBlock,
      name: 'Historical Data',
      longDescription: 'Fetch OHLCV market data.',
    },
    generic_webhook: {
      ...baseBlock,
      name: 'Webhook',
      category: 'triggers',
    },
    gmail: {
      ...baseBlock,
      name: 'Gmail',
      category: 'tools',
      subBlocks: [
        {
          id: 'credential',
          type: 'oauth-input',
          provider: 'google-email',
          serviceId: 'gmail',
          required: true,
        },
      ],
    },
    reddit: {
      ...baseBlock,
      name: 'Reddit',
      category: 'tools',
      subBlocks: [
        {
          id: 'credential',
          type: 'oauth-input',
          provider: 'reddit',
          serviceId: 'reddit',
          required: true,
        },
      ],
    },
    slack: {
      ...baseBlock,
      name: 'Slack',
      category: 'tools',
      subBlocks: [
        {
          id: 'authMethod',
          type: 'dropdown',
          options: [
            { id: 'oauth', label: 'TradingGoose Bot' },
            { id: 'bot_token', label: 'Custom Bot' },
          ],
        },
        {
          id: 'credential',
          type: 'oauth-input',
          provider: 'slack',
          serviceId: 'slack',
          condition: { field: 'authMethod', value: 'oauth' },
        },
        {
          id: 'botToken',
          type: 'short-input',
          condition: { field: 'authMethod', value: 'bot_token' },
        },
      ],
    },
  }

  return {
    registry,
    getBlock: (blockType: string) => registry[blockType as keyof typeof registry],
    getAllBlocks: () => Object.values(registry),
    getAllBlockTypes: () => Object.keys(registry),
    getBlocksByCategory: () => [],
    isValidBlockType: (blockType: string) => blockType in registry,
  }
})

describe('getAvailableBlocksServerTool', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetOAuthProviderAvailability.mockImplementation(async (providerIds: string[]) =>
      Object.fromEntries(providerIds.map((providerId) => [providerId, providerId === 'reddit']))
    )
  })

  it('lists available blocks with Mermaid contracts instead of schema metadata', async () => {
    const { getAvailableBlocksServerTool } = await import('./get-available-blocks')
    const result = await getAvailableBlocksServerTool.execute({})

    expect(result.blocks.length).toBeGreaterThan(0)

    const agentBlock = result.blocks.find((block) => block.blockType === 'agent')
    expect(agentBlock).toEqual(
      expect.objectContaining({
        blockType: 'agent',
        category: 'block',
        mermaidContract: expect.objectContaining({
          renderKind: 'standard',
        }),
      })
    )
    expect(agentBlock).not.toHaveProperty('inputs')
    expect(agentBlock).not.toHaveProperty('outputs')

    const loopBlock = result.blocks.find((block) => block.blockType === 'loop')
    expect(loopBlock).toEqual(
      expect.objectContaining({
        blockType: 'loop',
        blockName: 'Loop',
        category: 'block',
        mermaidContract: expect.objectContaining({
          renderKind: 'loop_container',
        }),
      })
    )
  }, 10_000)

  it('hides only unconditionally OAuth-gated blocks whose system integration is unavailable', async () => {
    const { getAvailableBlocksServerTool } = await import('./get-available-blocks')
    const result = await getAvailableBlocksServerTool.execute({})

    expect(mockGetOAuthProviderAvailability).toHaveBeenCalledWith(
      expect.arrayContaining(['google-email', 'reddit'])
    )
    expect(mockGetOAuthProviderAvailability).not.toHaveBeenCalledWith(
      expect.arrayContaining(['slack'])
    )
    expect(result.blocks.some((block) => block.blockType === 'reddit')).toBe(true)
    expect(result.blocks.some((block) => block.blockType === 'gmail')).toBe(false)
    expect(result.blocks.some((block) => block.blockType === 'slack')).toBe(true)
  })

  it('filters blocks by catalog category', async () => {
    const { getAvailableBlocksServerTool } = await import('./get-available-blocks')
    const triggerResult = await getAvailableBlocksServerTool.execute({ category: 'trigger' })
    const toolResult = await getAvailableBlocksServerTool.execute({ category: 'tool' })
    const blockResult = await getAvailableBlocksServerTool.execute({ category: 'block' })

    expect(triggerResult.blocks.map((block) => block.blockType)).toEqual(
      expect.arrayContaining(['generic_webhook'])
    )
    expect(triggerResult.blocks.every((block) => block.category === 'trigger')).toBe(true)
    expect(toolResult.blocks.map((block) => block.blockType)).toEqual(
      expect.arrayContaining(['reddit', 'slack'])
    )
    expect(toolResult.blocks.every((block) => block.category === 'tool')).toBe(true)
    expect(blockResult.blocks.map((block) => block.blockType)).toEqual(
      expect.arrayContaining(['agent', 'function'])
    )
    expect(blockResult.blocks.every((block) => block.category === 'block')).toBe(true)
    expect(toolResult.blocks.map((block) => block.blockType)).not.toContain('gmail')
  })

  it('matches mixed capability queries across different built-in blocks', async () => {
    const { getAvailableBlocksServerTool } = await import('./get-available-blocks')
    const result = await getAvailableBlocksServerTool.execute({
      query: 'OHLCV indicator',
    })

    expect(result.blocks.map((block) => block.blockType)).toEqual(
      expect.arrayContaining(['historical_data', 'function'])
    )
  })
})
