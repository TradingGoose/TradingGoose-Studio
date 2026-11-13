import { describe, expect, test } from 'vitest'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { BlockType } from '@/executor/consts'
import type { ExecutionResult } from '@/executor/types'

describe('buildTraceSpans', () => {
  test.each([BlockType.WORKFLOW, BlockType.WORKFLOW_INPUT])(
    'retains %s child traces alongside the parent model usage',
    (blockType) => {
      const modelLog = {
        id: 'local-model-occurrence',
        blockId: 'local-agent',
        blockType: 'agent',
        startedAt: '2026-09-17T00:00:00.000Z',
        endedAt: '2026-09-17T00:00:00.001Z',
        durationMs: 1,
        success: true,
        output: { content: 'business output' },
        inference: {
          model: 'test-model',
          cost: { total: 1, status: 'reported' as const },
          tokens: { total: 10 },
          generatedFields: [],
        },
      }
      const result = { success: true, output: {}, metadata: { duration: 1 } }
      const child = buildTraceSpans({
        ...result,
        logs: [
          {
            ...modelLog,
            blockId: 'child-agent',
            inference: {
              generatedFields: [],
              model: 'test-model',
              cost: { total: 2, status: 'reported' },
              tokens: { total: 20 },
            },
            id: 'trace-spans.test.ts:saved-occurrence:1',
          },
        ],
      }).traceSpans
      const parent = buildTraceSpans({
        ...result,
        logs: [
          modelLog,
          {
            ...modelLog,
            blockId: 'child-call',
            blockType,
            output: {
              childTraceSpans: child,
            },
            id: 'trace-spans.test.ts:saved-occurrence:2',
          },
        ],
      }).traceSpans
      const snapshot = structuredClone(parent)

      expect(parent[0].children?.[1].children).toMatchObject([{ blockId: 'child-agent' }])
      expect(parent[0].children?.[0].inference).toEqual(modelLog.inference)
      expect(parent).toEqual(snapshot)
    }
  )

  test('should handle blocks without tool calls', () => {
    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { content: 'Final output' },
      logs: [
        {
          id: 'trace-spans.test.ts:saved-occurrence:6',
          blockId: 'text-1',
          blockName: 'Text Block',
          blockType: 'text',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:01.000Z',
          durationMs: 1000,
          success: true,
          input: { content: 'Hello world' },
          output: { content: 'Hello world' },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const textSpan = traceSpans[0]
    expect(textSpan.type).toBe('text')
    expect(textSpan).not.toHaveProperty('toolCalls')
  })

  test('should flatten nested child workflow trace spans recursively', () => {
    const nestedChildSpan = {
      id: 'nested-workflow-span',
      name: 'Nested Workflow Block',
      type: 'workflow',
      blockId: 'nested-workflow-block-id',
      duration: 3000,
      startTime: '2024-01-01T10:00:01.000Z',
      endTime: '2024-01-01T10:00:04.000Z',
      status: 'success' as const,
      output: {
        childTraceSpans: [
          {
            id: 'grand-wrapper',
            name: 'Workflow Execution',
            type: 'workflow',
            duration: 3000,
            startTime: '2024-01-01T10:00:01.000Z',
            endTime: '2024-01-01T10:00:04.000Z',
            status: 'success' as const,
            children: [
              {
                id: 'grand-child-block',
                name: 'Deep API Call',
                type: 'api',
                duration: 1500,
                startTime: '2024-01-01T10:00:01.500Z',
                endTime: '2024-01-01T10:00:03.000Z',
                status: 'success' as const,
                input: { path: '/v1/test' },
                output: { result: 'ok' },
              },
            ],
          },
        ],
      },
    }

    const toolSpan = {
      id: 'child-tool-span',
      name: 'Helper Tool',
      type: 'tool',
      duration: 1000,
      startTime: '2024-01-01T10:00:04.000Z',
      endTime: '2024-01-01T10:00:05.000Z',
      status: 'success' as const,
    }

    const mockExecutionResult: ExecutionResult = {
      success: true,
      output: { result: 'parent output' },
      logs: [
        {
          id: 'trace-spans.test.ts:saved-occurrence:8',
          blockId: 'workflow-1',
          blockName: 'Child Workflow',
          blockType: 'workflow_input',
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:00:05.000Z',
          durationMs: 5000,
          success: true,
          output: {
            childWorkflowName: 'Child Workflow',
            childTraceSpans: [
              {
                id: 'child-wrapper',
                name: 'Workflow Execution',
                type: 'workflow',
                duration: 5000,
                startTime: '2024-01-01T10:00:00.000Z',
                endTime: '2024-01-01T10:00:05.000Z',
                status: 'success' as const,
                children: [nestedChildSpan, toolSpan],
              },
            ],
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const workflowSpan = traceSpans[0]
    expect(workflowSpan.type).toBe('workflow_input')
    expect(workflowSpan.children).toBeDefined()
    expect(workflowSpan.children).toHaveLength(2)

    const nestedWorkflowSpan = workflowSpan.children?.find((span) => span.type === 'workflow')
    expect(nestedWorkflowSpan).toBeDefined()
    expect(nestedWorkflowSpan?.name).toBe('Nested Workflow Block')
    expect(nestedWorkflowSpan?.children).toBeDefined()
    expect(nestedWorkflowSpan?.children).toHaveLength(1)
    expect(nestedWorkflowSpan?.children?.[0].name).toBe('Deep API Call')
    expect(nestedWorkflowSpan?.children?.[0].type).toBe('api')

    const helperToolSpan = workflowSpan.children?.find((span) => span.id === 'child-tool-span')
    expect(helperToolSpan?.type).toBe('tool')

    const syntheticWrappers = workflowSpan.children?.filter(
      (span) => span.name === 'Workflow Execution'
    )
    expect(syntheticWrappers).toHaveLength(0)
  })

  test('should handle nested child workflow errors with proper hierarchy', () => {
    const functionErrorSpan = {
      id: 'function-error-span',
      name: 'Function 1',
      type: 'function',
      duration: 200,
      startTime: '2024-01-01T10:01:02.000Z',
      endTime: '2024-01-01T10:01:02.200Z',
      status: 'error' as const,
      blockId: 'function-1',
      output: {
        error: 'Syntax Error: Line 1: `retur "HELLO"` - Unexpected string',
      },
    }

    const rainbowCupcakeSpan = {
      id: 'rainbow-workflow-span',
      name: 'Rainbow Cupcake',
      type: 'workflow',
      duration: 300,
      startTime: '2024-01-01T10:01:02.000Z',
      endTime: '2024-01-01T10:01:02.300Z',
      status: 'error' as const,
      blockId: 'workflow-rainbow',
      output: {
        childWorkflowName: 'rainbow-cupcake',
        error: 'Syntax Error: Line 1: `retur "HELLO"` - Unexpected string',
        childTraceSpans: [functionErrorSpan],
      },
    }

    const mockExecutionResult: ExecutionResult = {
      success: false,
      output: { result: null },
      metadata: {
        duration: 3000,
        startTime: '2024-01-01T10:01:00.000Z',
      },
      logs: [
        {
          id: 'trace-spans.test.ts:saved-occurrence:9',
          blockId: 'workflow-silk',
          blockName: 'Silk Pond',
          blockType: 'workflow_input',
          startedAt: '2024-01-01T10:01:00.000Z',
          endedAt: '2024-01-01T10:01:03.000Z',
          durationMs: 3000,
          success: false,
          error:
            'Error in child workflow "silk-pond": Error in child workflow "rainbow-cupcake": Syntax Error',
          output: {
            childWorkflowName: 'silk-pond',
            childTraceSpans: [rainbowCupcakeSpan],
          },
        },
      ],
    }

    const { traceSpans } = buildTraceSpans(mockExecutionResult)

    expect(traceSpans).toHaveLength(1)
    const workflowExecutionSpan = traceSpans[0]
    expect(workflowExecutionSpan.name).toBe('Workflow Execution')
    expect(workflowExecutionSpan.status).toBe('error')
    expect(workflowExecutionSpan.children).toBeDefined()
    expect(workflowExecutionSpan.children).toHaveLength(1)

    const silkPondSpan = workflowExecutionSpan.children?.[0]
    expect(silkPondSpan?.name).toBe('Silk Pond')
    expect(silkPondSpan?.status).toBe('error')
    expect(silkPondSpan?.children).toBeDefined()
    expect(silkPondSpan?.children).toHaveLength(1)

    const rainbowSpan = silkPondSpan?.children?.[0]
    expect(rainbowSpan?.name).toBe('Rainbow Cupcake')
    expect(rainbowSpan?.status).toBe('error')
    expect(rainbowSpan?.type).toBe('workflow')
    expect(rainbowSpan?.children).toBeDefined()
    expect(rainbowSpan?.children).toHaveLength(1)

    const functionSpan = rainbowSpan?.children?.[0]
    expect(functionSpan?.name).toBe('Function 1')
    expect(functionSpan?.status).toBe('error')
    expect((functionSpan?.output as { error?: string })?.error).toContain('Syntax Error')
  })
})

test('does not interpret schema-owned AI report names as internal trace facts', () => {
  const business = {
    model: 1,
    tokens: 'customer',
    cost: { total: 999 },
    providerTiming: { timeSegments: [] },
    toolCalls: { list: [{ name: 'schema value' }] },
  }
  const { traceSpans } = buildTraceSpans({
    success: true,
    output: business,
    metadata: { duration: 1 },
    logs: [
      {
        id: 'trace-spans.test.ts:saved-occurrence:10',
        blockId: 'agent',
        blockType: 'agent',
        blockName: 'Agent',
        startedAt: '2026-11-08T00:00:00Z',
        endedAt: '2026-11-08T00:00:01Z',
        durationMs: 1000,
        success: true,
        output: business,
      },
    ],
  })
  const agentSpan = traceSpans[0].children!.find((span) => span.type === 'agent')!
  expect(agentSpan.output).toEqual(business)
  expect(agentSpan.cost).toBeUndefined()
  expect(agentSpan.tokens).toBeUndefined()
  expect(agentSpan.model).toBeUndefined()
  expect(agentSpan).not.toHaveProperty('toolCalls')
})

test.each([true, false])(
  'keeps the native history reference and accounting without rebuilding a transcript (success=%s)',
  (success) => {
    const history = {
      threadId: 'workflow-agent:run',
      resourceId: 'workflow-execution:workspace:execution',
      runId: 'run',
    }
    const inference = {
      history,
      model: 'native/outer',
      tokens: { prompt: 0, completion: 2 },
      cost: { total: 0.004, status: 'reported' as const },
      generatedFields: [],
    }
    const built = buildTraceSpans({
      success,
      output: {},
      metadata: { duration: 1 },
      logs: [
        {
          id: 'native-run-occurrence',
          blockId: 'agent',
          blockType: 'agent',
          startedAt: '2026-11-10T00:00:00.000Z',
          endedAt: '2026-11-10T00:00:00.001Z',
          durationMs: 1,
          success,
          output: { content: 'answer' },
          inference,
          ...(success ? {} : { error: 'Later model failure' }),
        },
      ],
    })
    const agent = built.traceSpans[0].children![0]
    expect(agent.inference).toBe(inference)
    expect(agent.inference?.history).toBe(history)
    expect(agent.children).toEqual([])
    expect(agent).not.toHaveProperty('toolCalls')
    expect(agent).not.toHaveProperty('providerTiming')
    expect(agent.tokens).toEqual(inference.tokens)
    expect(agent.cost).toEqual(inference.cost)
  }
)
