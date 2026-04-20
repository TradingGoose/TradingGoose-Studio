import { describe, expect, it } from 'vitest'
import { getBlocksAndToolsServerTool } from './get-blocks-and-tools'

describe('getBlocksAndToolsServerTool', () => {
  it('lists available blocks with Mermaid contracts instead of schema metadata', async () => {
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

  it('matches mixed capability queries across different built-in blocks', async () => {
    const result = await getBlocksAndToolsServerTool.execute({
      query: 'OHLCV indicator',
    })

    expect(result.blocks.map((block) => block.blockType)).toEqual(
      expect.arrayContaining(['historical_data', 'function'])
    )
  })
})
