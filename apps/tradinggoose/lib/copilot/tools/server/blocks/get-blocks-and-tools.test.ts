import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetOAuthProviderAvailability = vi.hoisted(() => vi.fn())

vi.mock('@/lib/oauth/oauth.server', () => ({
  getOAuthProviderAvailability: mockGetOAuthProviderAvailability,
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
      triggerAllowed: true,
    },
    gmail: {
      ...baseBlock,
      name: 'Gmail',
      category: 'tools',
      triggerAllowed: true,
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
      triggerAllowed: true,
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

describe('getBlocksAndToolsServerTool', () => {
  beforeEach(() => {
    vi.resetModules()
    mockGetOAuthProviderAvailability.mockImplementation(async (providerIds: string[]) =>
      Object.fromEntries(providerIds.map((providerId) => [providerId, providerId === 'reddit']))
    )
  })

  it('lists available blocks with Mermaid contracts instead of schema metadata', async () => {
    const { getBlocksAndToolsServerTool } = await import('./get-blocks-and-tools')
    const result = await getBlocksAndToolsServerTool.execute({})

    expect(result.blocks.length).toBeGreaterThan(0)

    const agentBlock = result.blocks.find((block) => block.blockType === 'agent')
    expect(agentBlock).toEqual(
      expect.objectContaining({
        blockType: 'agent',
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
        mermaidContract: expect.objectContaining({
          renderKind: 'loop_container',
        }),
      })
    )
  })

  it('hides OAuth integration blocks whose system integration is unavailable', async () => {
    const { getBlocksAndToolsServerTool } = await import('./get-blocks-and-tools')
    const result = await getBlocksAndToolsServerTool.execute({})

    expect(mockGetOAuthProviderAvailability).toHaveBeenCalledWith(
      expect.arrayContaining(['google-email', 'reddit', 'slack'])
    )
    expect(result.blocks.some((block) => block.blockType === 'reddit')).toBe(true)
    expect(result.blocks.some((block) => block.blockType === 'gmail')).toBe(false)
    expect(result.blocks.some((block) => block.blockType === 'slack')).toBe(false)
  })

  it('uses the same availability filter for trigger block discovery', async () => {
    const { getTriggerBlocksServerTool } = await import('./get-trigger-blocks')
    const result = await getTriggerBlocksServerTool.execute({})

    expect(result.triggerBlockIds).not.toContain('gmail')
    expect(result.triggerBlockIds).not.toContain('slack')
  })

  it('matches mixed capability queries across different built-in blocks', async () => {
    const { getBlocksAndToolsServerTool } = await import('./get-blocks-and-tools')
    const result = await getBlocksAndToolsServerTool.execute({
      query: 'OHLCV indicator',
    })

    expect(result.blocks.map((block) => block.blockType)).toEqual(
      expect.arrayContaining(['historical_data', 'function'])
    )
  })
})
