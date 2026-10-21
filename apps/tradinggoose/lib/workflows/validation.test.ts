import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { buildCopilotServerToolError } from '@/lib/copilot/tools/client/server-tool-response'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { AgentBlock } from '@/blocks/blocks/agent'
import { DatadogBlock } from '@/blocks/blocks/datadog'
import { LoopBlock } from '@/blocks/blocks/loop'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { MongoDBBlock } from '@/blocks/blocks/mongodb'
import { ParallelContainerBlock } from '@/blocks/blocks/parallel_container'
import { PolymarketBlock } from '@/blocks/blocks/polymarket'
import { SerperBlock } from '@/blocks/blocks/serper'
import { SttBlock } from '@/blocks/blocks/stt'
import { VideoGeneratorBlock } from '@/blocks/blocks/video_generator'
import { WaitBlock } from '@/blocks/blocks/wait'
import { YouTubeBlock } from '@/blocks/blocks/youtube'
import { ZepBlock } from '@/blocks/blocks/zep'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
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

function workflowWithValues(
  type: string,
  values: Record<string, unknown>,
  modes: Pick<BlockState, 'advancedMode' | 'triggerMode'> = {}
): WorkflowState {
  return {
    blocks: {
      sample: {
        id: 'sample',
        type,
        name: 'Sample',
        position: { x: 0, y: 0 },
        subBlocks: Object.fromEntries(
          Object.entries(values).map(([id, value]) => [
            id,
            { id, type: 'short-input', value: value as any },
          ])
        ),
        outputs: {},
        enabled: true,
        ...modes,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

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

    const result = validateWorkflowState(workflowWithValues('agent', {}))

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
    const result = validateWorkflowState(workflowWithValues('sample', { [id]: value }))
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      expect.stringContaining(`invalid block sub-block values for ${id}`),
    ])
  })

  it.each([
    [true, 'run', false],
    [false, 'run', true],
    [undefined, 'run', true],
    [{ field: 'operation', value: 'run' }, 'run', false],
    [{ field: 'operation', value: 'run' }, 'skip', true],
    [() => ({ field: 'operation', value: 'run' }), 'run', false],
    [() => ({ field: 'operation', value: 'run' }), 'skip', true],
  ])(
    'checks blank numeric values against required metadata (case %#)',
    (required, operation, valid) => {
      validationMocks.getBlock.mockReturnValue({
        subBlocks: [
          { id: 'attempts', type: 'short-input', inputType: 'number', min: 1, required },
          { id: 'operation', type: 'short-input' },
        ],
        inputs: { attempts: { type: 'number' } },
      })
      expect(
        validateWorkflowState(workflowWithValues('sample', { attempts: '', operation })).valid
      ).toBe(valid)
    }
  )

  it.each([
    [YouTubeBlock, {}, 'maxResults'],
    [Mem0Block, { operation: 'search' }, 'limit'],
    [ZepBlock, { operation: 'get_messages' }, 'limit'],
  ] as const)('preserves optional numeric blanks on %s', (config, values, field) => {
    validationMocks.getBlock.mockReturnValue(config)
    const state = workflowWithValues(config.type, {})
    state.blocks.sample.subBlocks = buildInitialSubBlockStates(
      config.subBlocks,
      values
    ) as BlockState['subBlocks']
    expect(state.blocks.sample.subBlocks[field].value).toBe('')
    expect(validateWorkflowState(state).valid).toBe(true)
  })

  it('requires container edge endpoints to exist as blocks', () => {
    const state = workflowWithValues('sample', {})
    state.loops.loop = { id: 'loop', nodes: [], loopType: 'for', iterations: 1 }
    state.parallels.parallel = { id: 'parallel', nodes: [], parallelType: 'count', count: 1 }
    state.edges = [{ id: 'orphan', source: 'loop', target: 'parallel' }]
    expect(validateWorkflowState(state).errors).toEqual([
      "Edge references non-existent source block 'loop'",
      "Edge references non-existent target block 'parallel'",
    ])
  })

  it('preserves references on numeric-looking fields declared as strings', () => {
    validationMocks.getBlock.mockReturnValue({
      subBlocks: [
        { id: 'timeValue', type: 'short-input', inputType: 'number', integer: true, min: 1 },
      ],
      inputs: { timeValue: { type: 'string' } },
    })
    const result = validateWorkflowState(
      workflowWithValues('wait', { timeValue: '<source.seconds>' })
    )
    expect(result.valid).toBe(true)
  })

  it.each([
    ['whisper-1', true],
    ['nova-3', false],
  ])('validates speech model %s against only the active provider', (model, valid) => {
    validationMocks.getBlock.mockReturnValue(SttBlock)
    expect(
      validateWorkflowState(workflowWithValues('stt', { provider: 'whisper', model })).valid
    ).toBe(valid)
  })

  it.each([
    ['gpt-4.1', 1.5, true],
    ['claude-sonnet-4-6', 1.5, false],
  ])('uses the active temperature bounds for %s', (model, temperature, valid) => {
    validationMocks.getBlock.mockReturnValue(AgentBlock)
    expect(validateWorkflowState(workflowWithValues('agent', { model, temperature })).valid).toBe(
      valid
    )
  })

  it.each([
    ['advancedMode', 'basic', 'advanced'],
    ['triggerMode', undefined, 'trigger'],
  ] as const)('validates only the active %s variant', (mode, defaultMode, alternateMode) => {
    validationMocks.getBlock.mockReturnValue({
      subBlocks: [
        { id: 'model', type: 'dropdown', mode: defaultMode, options: [{ id: 'default' }] },
        { id: 'model', type: 'dropdown', mode: alternateMode, options: [{ id: 'alternate' }] },
      ],
      inputs: {},
    })
    for (const active of [false, true]) {
      expect(
        validateWorkflowState(
          workflowWithValues(
            'sample',
            { model: active ? 'alternate' : 'default' },
            { [mode]: active }
          )
        ).valid
      ).toBe(true)
    }
  })

  it('evaluates conditional variants against canonical params with shared condition semantics', () => {
    validationMocks.getBlock.mockReturnValue({
      subBlocks: [
        { id: 'providerReference', canonicalParamId: 'provider', type: 'short-input' },
        { id: 'operation', type: 'short-input' },
        {
          id: 'attempts',
          type: 'short-input',
          inputType: 'number',
          min: 1,
          max: 3,
          condition: () => ({
            field: 'provider',
            value: ['whisper', 'deepgram'],
            and: { field: 'operation', value: 'disabled', not: true },
          }),
        },
      ],
      inputs: { attempts: { type: 'number' } },
    })
    const values = { providerReference: { id: 'whisper' }, operation: 'run', attempts: 4 }
    expect(validateWorkflowState(workflowWithValues('sample', values)).valid).toBe(false)
    expect(
      validateWorkflowState(workflowWithValues('sample', { ...values, operation: 'disabled' }))
        .valid
    ).toBe(true)
  })

  it.each(['  <variable.startTime>  ', '  {{START_TIME}}  '])(
    'preserves supported numeric references: %s',
    (startTs) => {
      validationMocks.getBlock.mockReturnValue(PolymarketBlock)
      const state = workflowWithValues('polymarket', { operation: 'get_price_history', startTs })
      expect(validateWorkflowState(state).valid).toBe(true)
      expect(state.blocks.sample.subBlocks.startTs.value).toBe(startTs)
    }
  )

  it.each(['{{EPOCH_PREFIX}}000', '<variable.epochPrefix>000'])(
    'preserves numeric interpolation templates: %s',
    (from) => {
      validationMocks.getBlock.mockReturnValue(DatadogBlock)
      expect(
        validateWorkflowState(
          workflowWithValues('datadog', { operation: 'datadog_query_timeseries', from })
        ).valid
      ).toBe(true)
    }
  )

  it.each(['<variable.unit>', '<source.unit>', '{{UNIT}}', '{{UNIT_PREFIX}}onds'])(
    'preserves supported dropdown references: %s',
    (timeUnit) => {
      validationMocks.getBlock.mockReturnValue(WaitBlock)
      const state = workflowWithValues('wait', { timeUnit })
      expect(validateWorkflowState(state).valid).toBe(true)
      expect(state.blocks.sample.subBlocks.timeUnit.value).toBe(timeUnit)
    }
  )

  it.each([
    [SerperBlock, { num: 10 }, true],
    [SerperBlock, { num: '10' }, true],
    [SerperBlock, { num: 17 }, false],
    [SerperBlock, { num: true }, false],
    [SerperBlock, { num: null }, false],
    [SerperBlock, { num: [10] }, false],
    [VideoGeneratorBlock, { provider: 'runway', duration: 5 }, true],
    [VideoGeneratorBlock, { provider: 'runway', duration: '5' }, true],
    [VideoGeneratorBlock, { provider: 'runway', duration: 6 }, false],
    [VideoGeneratorBlock, { provider: 'veo', duration: 6 }, true],
    [WaitBlock, { timeUnit: 'seconds' }, true],
    [WaitBlock, { timeUnit: 'invalid' }, false],
    [WaitBlock, { timeUnit: 10 }, false],
    [MongoDBBlock, { operation: 'update', upsert: true, multi: false }, true],
    [MongoDBBlock, { operation: 'update', upsert: 'true', multi: 'false' }, true],
    [MongoDBBlock, { operation: 'update', upsert: 'invalid' }, false],
    [MongoDBBlock, { operation: 'update', upsert: 0 }, false],
    [MongoDBBlock, { operation: 'update', upsert: 1 }, false],
    [MongoDBBlock, { operation: 'update', upsert: null }, false],
    [MongoDBBlock, { operation: 'update', multi: [true] }, false],
    [MongoDBBlock, { operation: 'update', multi: {} }, false],
  ] as const)(
    'validates dropdown options using declared input types (case %#)',
    (config, values, valid) => {
      validationMocks.getBlock.mockReturnValue(config)
      expect(validateWorkflowState(workflowWithValues(config.type, values)).valid).toBe(valid)
    }
  )

  it.each(['invalid', '<>', '{{}}000'])(
    'rejects invalid numeric literals and malformed references: %s',
    (startTs) => {
      validationMocks.getBlock.mockReturnValue(PolymarketBlock)
      expect(
        validateWorkflowState(
          workflowWithValues('polymarket', { operation: 'get_price_history', startTs })
        ).valid
      ).toBe(false)
    }
  )

  it.each([
    [LoopBlock, { loopType: 'for', iterations: '' }],
    [LoopBlock, { loopType: 'for', iterations: '  ' }],
    [ParallelContainerBlock, { parallelType: 'count', count: '' }],
    [ParallelContainerBlock, { parallelType: 'count', count: '  ' }],
    [LoopBlock, { loopType: 'for', iterations: '<variable.count>0' }],
    [ParallelContainerBlock, { parallelType: 'count', count: '{{COUNT}}0' }],
    [LoopBlock, { loopType: '<variable.mode>' }],
    [ParallelContainerBlock, { parallelType: '{{MODE}}' }],
  ] as const)('rejects invalid literals on reference-disabled fields', (config, values) => {
    validationMocks.getBlock.mockReturnValue(config)
    expect(validateWorkflowState(workflowWithValues(config.type, values)).valid).toBe(false)
  })
})
