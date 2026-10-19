import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlocksMetadataServerTool } from '@/lib/copilot/tools/server/blocks/get-blocks-metadata'
import { GetBlocksMetadataResult } from '@/lib/copilot/tools/shared/schemas'

const mockGetOAuthProviderAvailability = vi.hoisted(() => vi.fn())

vi.mock('@/lib/oauth/oauth.server', () => ({
  getOAuthProviderAvailability: mockGetOAuthProviderAvailability,
}))

vi.mock('@/blocks/registry', async () => {
  const { HistoricalDataBlock } = await import('@/blocks/blocks/historical_data')
  const { LoopBlock } = await import('@/blocks/blocks/loop')
  const { ParallelContainerBlock } = await import('@/blocks/blocks/parallel_container')
  const registry = {
    historical_data: HistoricalDataBlock,
    loop: LoopBlock,
    parallel: ParallelContainerBlock,
    github: {
      name: 'GitHub',
      longDescription: 'Interact with GitHub repositories.',
      bestPractices: 'Use explicit repository owner and repo names.',
      category: 'tools',
      authMode: 'apiKey',
      subBlocks: [
        {
          id: 'operation',
          type: 'dropdown',
          options: [
            { id: 'github_pr', label: 'Get PR details' },
            { id: 'github_comment', label: 'Create PR comment' },
          ],
        },
      ],
      tools: {
        config: {
          tool: ({ operation }: { operation: string }) => operation,
        },
      },
    },
    condition: {
      name: 'Condition',
      description: 'Branch on a condition.',
      category: 'blocks',
      subBlocks: [],
      outputs: {},
    },
    input_trigger: {
      name: 'Input Form',
      description: 'Collect structured workflow input.',
      category: 'triggers',
      subBlocks: [
        {
          id: 'inputFormat',
          type: 'input-format',
        },
      ],
      outputs: {},
    },
    function: {
      name: 'Function',
      description: 'Run custom logic.',
      longDescription: 'Execute custom code.',
      category: 'blocks',
      subBlocks: [
        {
          id: 'code',
          type: 'code',
        },
      ],
      inputs: {
        code: { type: 'string', description: 'Code to execute' },
      },
      outputs: {},
    },
    reddit: {
      name: 'Reddit',
      description: 'Read Reddit posts.',
      category: 'tools',
      authMode: 'oauth',
      subBlocks: [
        {
          id: 'credential',
          type: 'oauth-input',
          provider: 'reddit',
          serviceId: 'reddit',
          required: true,
        },
      ],
      outputs: {},
    },
    slack: {
      name: 'Slack',
      description: 'Send Slack messages.',
      category: 'tools',
      authMode: 'oauth',
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
      outputs: {},
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

vi.mock('@/tools/registry', () => ({
  tools: {
    github_pr: { description: 'Fetch GitHub pull request details.' },
    github_comment: { description: 'Create a GitHub pull request comment.' },
  },
}))

describe('getBlocksMetadataServerTool', () => {
  beforeEach(() => {
    mockGetOAuthProviderAvailability.mockReset()
    mockGetOAuthProviderAvailability.mockImplementation(async (providerIds: string[]) =>
      Object.fromEntries(providerIds.map((providerId) => [providerId, false]))
    )
  })

  it('serializes historical range choices and exact provider-specific accepted IDs', async () => {
    const result = await getBlocksMetadataServerTool.execute({ blockTypes: ['historical_data'] })
    const range = result.metadata.historical_data?.subBlocks?.find(
      (subBlock) => subBlock.id === 'rangePresetId'
    )

    expect(range).toMatchObject({
      title: 'Data Range',
      required: true,
      description: expect.stringContaining('Select "custom" for explicit start/end dates'),
    })
    expect(range?.options).toContainEqual({ id: 'custom', label: 'Custom dates' })
    expect(range?.description).toContain('yahoo-finance: custom, 1d, 5d, 1m, 1y, 5y, all')
    expect(range?.description).toContain('alpaca: custom, 1d, 5d, 1w, 1m, 3m, 1y, 5y, all')
    expect(range?.options).toContainEqual({ id: '1m', label: 'Latest 1 month' })
  })

  it('returns Mermaid profiles and operation variants instead of schema-shaped metadata', async () => {
    const result = await getBlocksMetadataServerTool.execute({
      blockTypes: [
        'github',
        'condition',
        'input_trigger',
        'function',
        'reddit',
        'slack',
        'loop',
        'parallel',
      ],
    })

    expect(result.metadata.github).toEqual(
      expect.objectContaining({
        blockType: 'github',
        blockName: 'GitHub',
        mermaidContract: expect.objectContaining({
          renderKind: 'standard',
        }),
        mermaidExamples: expect.objectContaining({
          minimalDocument: expect.any(String),
          connectedDocument: expect.any(String),
        }),
        operations: expect.arrayContaining([
          expect.objectContaining({
            id: 'github_pr',
            mermaidExamples: expect.objectContaining({
              minimalDocument: expect.any(String),
            }),
          }),
        ]),
      })
    )
    expect(result.metadata.github).not.toHaveProperty('inputs')
    expect(result.metadata.github).not.toHaveProperty('outputs')
    expect(result.metadata.github).not.toHaveProperty('inputSchema')
    expect(result.metadata.reddit).toBeUndefined()
    expect(result.metadata.slack).toEqual(
      expect.objectContaining({
        blockType: 'slack',
        blockName: 'Slack',
      })
    )

    expect(result.metadata.condition?.mermaidContract.renderKind).toBe('condition')
    expect(result.metadata.input_trigger?.mermaidExamples.minimalDocument).toContain(
      '"inputFormat"'
    )
    expect(result.metadata.input_trigger?.mermaidExamples.minimalDocument).not.toContain(
      '"inputSchema"'
    )
    expect(
      result.metadata.input_trigger?.subBlocks?.find((subBlock) => subBlock.id === 'inputFormat')
        ?.description
    ).toContain('listingIdentity')
    expect(result.metadata.input_trigger?.inputReferenceGrammar).toEqual(
      expect.objectContaining({
        hardRequirement: true,
        workflowOutputs: expect.objectContaining({
          syntax: '<block.output>',
          summary: expect.stringMatching(/Copy the exact `path` returned[\s\S]*returned `type`/),
          sourceTools: expect.arrayContaining([
            'read_block_outputs',
            'read_block_upstream_references',
          ]),
        }),
        workflowVariables: expect.objectContaining({
          syntax: '<variable.name>',
          summary: expect.stringContaining('Copy the exact workflow variable tag'),
          sourceTools: ['read_workflow'],
        }),
        environmentVariables: expect.objectContaining({
          syntax: '{{ENV_VAR_NAME}}',
          sourceTools: ['read_environment_variables'],
        }),
      })
    )
    expect(result.metadata.loop?.mermaidContract.renderKind).toBe('loop_container')
    expect(result.metadata.loop?.bestPractices).toContain('Loop Start')
    expect(result.metadata.loop?.bestPractices).toContain('Loop End')
    expect(result.metadata.loop?.bestPractices).toContain('target the Loop block alias itself')
    expect(result.metadata.loop?.mermaidExamples.connectedDocument).toContain('n1 --> n2')
    expect(result.metadata.loop?.mermaidExamples.connectedDocument).not.toContain(
      'n1 --> n2__loop_start'
    )
    expect(result.metadata.loop?.mermaidExamples.connectedDocument).toContain('n3 --> n2__loop_end')
    expect(result.metadata.parallel?.bestPractices).toContain('Parallel Start')
    expect(result.metadata.parallel?.bestPractices).toContain('Parallel End')
    expect(result.metadata.parallel?.bestPractices).toContain(
      'target the Parallel block alias itself'
    )
    expect(result.metadata.function?.inputReferenceGrammar?.blockSpecificRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Use available indicators with full Historical Data output',
          examples: expect.arrayContaining([
            'await indicator.RSI(<historical_data>, { Length: 7 })',
            'await indicator["custom-indicator-id"](<historical_data>)',
          ]),
        }),
        expect.objectContaining({
          title: 'Do not author custom Pine indicators inside Function blocks',
        }),
      ])
    )
  })

  it('exposes every canonical container parameter through standard block metadata', async () => {
    const result = GetBlocksMetadataResult.parse(
      await getBlocksMetadataServerTool.execute({ blockTypes: ['loop', 'parallel'] })
    )
    const loop = result.metadata.loop
    const parallel = result.metadata.parallel

    expect(loop?.subBlocks?.map((field) => field.id)).toEqual([
      'loopType',
      'iterations',
      'forEachItems',
      'whileCondition',
    ])
    expect(loop?.subBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'loopType',
          defaultValue: 'for',
          options: [
            { id: 'for', label: 'For Loop' },
            { id: 'forEach', label: 'For Each' },
            { id: 'while', label: 'While' },
            { id: 'doWhile', label: 'Do While' },
          ],
        }),
        expect.objectContaining({
          id: 'iterations',
          inputType: 'number',
          supportsReferences: false,
          integer: true,
          min: 1,
          max: 100,
          defaultValue: 5,
          condition: { field: 'loopType', value: 'for' },
        }),
        expect.objectContaining({
          id: 'forEachItems',
          defaultValue: '',
          description: expect.stringContaining('array, object, JSON text'),
          condition: { field: 'loopType', value: 'forEach' },
        }),
        expect.objectContaining({
          id: 'whileCondition',
          defaultValue: '',
          condition: { field: 'loopType', value: ['while', 'doWhile'] },
        }),
      ])
    )
    expect(parallel?.subBlocks?.map((field) => field.id)).toEqual([
      'parallelType',
      'count',
      'distribution',
    ])
    expect(parallel?.subBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'parallelType',
          defaultValue: 'count',
          options: [
            { id: 'count', label: 'Parallel Count' },
            { id: 'collection', label: 'Parallel Each' },
          ],
        }),
        expect.objectContaining({
          id: 'count',
          inputType: 'number',
          supportsReferences: false,
          integer: true,
          min: 1,
          max: 20,
          defaultValue: 5,
          condition: { field: 'parallelType', value: 'count' },
        }),
        expect.objectContaining({
          id: 'distribution',
          defaultValue: '',
          description: expect.stringContaining('array, object, JSON text'),
          condition: { field: 'parallelType', value: 'collection' },
        }),
      ])
    )
    expect(loop?.inputReferenceGrammar?.hardRequirement).toBe(true)
    expect(parallel?.inputReferenceGrammar?.hardRequirement).toBe(true)
  })
})
