import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks/registry', () => {
  const registry = {
    github: {
      name: 'GitHub',
      longDescription: 'Interact with GitHub repositories.',
      bestPractices: 'Use explicit repository owner and repo names.',
      triggerAllowed: true,
      authMode: 'apiKey',
      subBlocks: [
        {
          id: 'operation',
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
      subBlocks: [],
      outputs: {},
    },
    input_trigger: {
      name: 'Input Form',
      description: 'Collect structured workflow input.',
      triggerAllowed: true,
      subBlocks: [
        {
          id: 'inputFormat',
          type: 'input-format',
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
    vi.resetModules()
  })

  it('returns Mermaid profiles and operation variants instead of schema-shaped metadata', async () => {
    const { getBlocksMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
    )

    const result = await getBlocksMetadataServerTool.execute({
      blockIds: ['github', 'condition', 'input_trigger', 'loop'],
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

    expect(result.metadata.condition?.mermaidContract.renderKind).toBe('condition')
    expect(result.metadata.input_trigger?.mermaidExamples.minimalDocument).toContain(
      '"inputFormat"'
    )
    expect(result.metadata.input_trigger?.mermaidExamples.minimalDocument).not.toContain(
      '"inputSchema"'
    )
    expect(result.metadata.loop?.mermaidContract.renderKind).toBe('loop_container')
  })
})
