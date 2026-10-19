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

describe('canonical sub-block validation', () => {
  beforeEach(() => {
    validationMocks.getBlock.mockReset()
    validationMocks.getBlock.mockReturnValue({
      subBlocks: [
        { id: 'attempts', type: 'short-input', inputType: 'number', integer: true, min: 1, max: 3 },
        { id: 'mode', type: 'dropdown', options: [{ id: 'fast', label: 'Fast' }] },
        { id: 'message', type: 'long-input' },
      ],
      inputs: { attempts: { type: 'number' }, message: { type: 'string' } },
    })
  })

  it.each([
    ['attempts', 0],
    ['attempts', 4],
    ['attempts', 1.5],
    ['attempts', Number.NaN],
    ['mode', 'unknown'],
    ['message', false],
  ])('validates %s using metadata on any registered block', (id, value) => {
    const result = validateWorkflowState({
      blocks: {
        sample: {
          id: 'sample',
          type: 'sample',
          name: 'Sample',
          position: { x: 0, y: 0 },
          subBlocks: { [id]: { id, type: 'short-input', value: value as any } },
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      expect.stringContaining(`invalid block sub-block values for ${id}`),
    ])
  })

  it('preserves references on numeric-looking fields declared as strings', () => {
    validationMocks.getBlock.mockReturnValue({
      subBlocks: [
        { id: 'timeValue', type: 'short-input', inputType: 'number', integer: true, min: 1 },
      ],
      inputs: { timeValue: { type: 'string' } },
    })
    const result = validateWorkflowState({
      blocks: {
        wait: {
          id: 'wait',
          type: 'wait',
          name: 'Wait',
          position: { x: 0, y: 0 },
          subBlocks: {
            timeValue: { id: 'timeValue', type: 'short-input', value: '<source.seconds>' },
          },
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
    expect(result.valid).toBe(true)
  })
})
