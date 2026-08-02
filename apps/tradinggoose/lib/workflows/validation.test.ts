import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { buildCopilotServerToolError } from '@/lib/copilot/tools/client/server-tool-response'
import { sanitizeAgentToolsInBlocks, validateWorkflowState } from './validation'

const validationMocks = vi.hoisted(() => ({
  getBlock: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock('@/blocks/registry', () => ({
  getBlock: validationMocks.getBlock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: validationMocks.loggerError,
    warn: validationMocks.loggerWarn,
  }),
}))

const tool = (toolId?: string) => ({
  type: 'custom-tool',
  ...(toolId ? { toolId } : {}),
  schema: { function: { parameters: { type: 'object', properties: {} } } },
  code: '',
})

describe('sanitizeAgentToolsInBlocks', () => {
  beforeEach(() => {
    validationMocks.getBlock.mockReset()
    validationMocks.loggerError.mockClear()
    validationMocks.loggerWarn.mockClear()
  })

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

  it('keeps unexpected validation details out of structured client errors', async () => {
    const cause = new Error('database password=raw-secret')
    validationMocks.getBlock.mockImplementation(() => {
      throw cause
    })

    const result = validateWorkflowState({
      blocks: {
        block_1: {
          id: 'block_1',
          type: 'agent',
          name: 'Agent',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })

    expect(validationMocks.loggerError).toHaveBeenCalledWith(
      'Workflow validation failed with exception',
      cause
    )
    expect(result).toMatchObject({
      valid: false,
      errors: ['Workflow validation could not be completed.'],
    })

    const serverError = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(`Invalid edited workflow: ${result.errors.join('; ')}`)
    )
    const clientError = await buildCopilotServerToolError(
      Response.json(serverError.body, { status: serverError.status })
    )

    expect(serverError.status).toBe(422)
    expect(clientError.message).toContain('Workflow validation could not be completed')
    expect(JSON.stringify(serverError)).not.toContain('raw-secret')
    expect(clientError.message).not.toContain('raw-secret')
  })
})
