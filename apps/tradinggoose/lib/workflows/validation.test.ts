import { describe, expect, it } from 'vitest'
import { sanitizeAgentToolsInBlocks } from './validation'

const tool = (toolId?: string) => ({
  type: 'custom-tool',
  ...(toolId ? { toolId } : {}),
  schema: { function: { parameters: { type: 'object', properties: {} } } },
  code: '',
})

describe('sanitizeAgentToolsInBlocks', () => {
  it('removes agent custom tools without canonical runtime tool ids', () => {
    const { blocks, warnings } = sanitizeAgentToolsInBlocks({
      agent_1: {
        type: 'agent',
        name: 'Agent',
        subBlocks: {
          tools: {
            value: [tool('custom_tool-1'), tool(), tool('tool-2')],
          },
        },
      },
    })

    expect(warnings).toEqual(['Block Agent: removed 2 invalid tool(s)'])
    expect(blocks.agent_1.subBlocks.tools.value).toEqual([
      { ...tool('custom_tool-1'), usageControl: 'auto' },
    ])
  })
})
