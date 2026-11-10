/** @vitest-environment node */
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { beforeEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getInferenceFacts } from '@/lib/mastra/result'
import {
  hydrateCheckpointFunctionalPayloads,
  projectFunctionalBlocks,
} from '@/lib/workflow-archive/functional'
import type { WorkflowCheckpointSnapshot } from '@/lib/workflows/human-in-the-loop/types'
import { Executor } from '@/executor'
import { createMinimalWorkflow } from '@/executor/__test-utils__/executor-mocks'
import { checkpointFunctionalOutput, finalizeExecutorCheckpoint } from '@/executor/checkpoint'

const state = vi.hoisted(() => ({
  model: undefined as any,
  contacts: 0,
  payloads: [] as any[],
  verify: vi.fn(),
}))
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: () => state.model,
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@tradinggoose/db', () => ({ db: {} }))
// Financial refusal is an explicit seam here; real SQL holds are a separate fixture.
vi.mock('@/lib/mastra/financial-processors', () => ({
  financialProcessors: async () => ({
    inputProcessors: [],
    outputProcessors: [],
    getUsage: () => ({ totalTokens: 70 }),
    verifyComplete: state.verify,
  }),
}))
// Actual native payload IO/encryption is covered by lifecycle.storage.test.ts.
// This transport preserves the real projector and original result-index ordering.
vi.mock('@/lib/mastra/workflow-history', () => ({
  writeFunctionalPayload: async (scope: Record<string, any>, payload: any) => {
    const { checkpointFunctionalOutput } = await import('@/executor/checkpoint')
    const { actorUserId: _actor, ...owned } = scope
    const ref = {
      version: 1,
      purpose: 'workflow-agent',
      threadId: 'r10-controlled-native-transport',
      resourceId: 'r10-controlled-resource',
      messageIds: [`controlled-${state.payloads.length}`],
      digest: 'controlled-transport-digest',
      ...owned,
    }
    const toolResultIndexes = payload.tools.flatMap((run: any, index: number) =>
      run.success || run.result?.cost || run.result?.tokens ? [index] : []
    )
    state.payloads.push({
      ref,
      payload: JSON.parse(
        JSON.stringify(checkpointFunctionalOutput({ ...payload, toolResultIndexes }))
      ),
    })
    return ref
  },
  readFunctionalPayload: async (ref: any) => {
    const entry = state.payloads.find((entry) => entry.ref.runId === ref.runId)
    if (!entry) throw new Error('Unknown controlled payload')
    return entry.payload
  },
}))
vi.mock('@/blocks', () => ({ getAllBlocks: () => [], getBlock: () => undefined }))
vi.mock('@/tools', () => ({ executeTool: vi.fn(), getToolAsync: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/executor/handlers/agent/skills-resolver', () => ({
  resolveSkillMetadata: async () => [],
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
const literal = ' completed <working_memory>literal🔥</working_memory>\n '
beforeEach(() => {
  vi.clearAllMocks()
  state.contacts = 0
  state.payloads.length = 0
  state.verify.mockRejectedValue(new Error('Original financial acceptance refused'))
})

function workflow(kind: 'agent' | 'evaluator' | 'router', pause: boolean) {
  const result = createMinimalWorkflow()
  result.blocks[1].metadata = { id: kind, name: kind }
  result.blocks[1].config = {
    tool: 'llm_chat',
    params: {
      model: 'openai/gpt-4.1',
      userPrompt: 'Complete once',
      prompt: 'Choose approval',
      content: 'Evaluate once',
      metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
    },
  }
  if (pause) {
    result.blocks.push(
      {
        id: 'approval',
        position: { x: 200, y: 0 },
        enabled: true,
        inputs: {},
        outputs: {},
        metadata: { id: 'human_in_the_loop', name: 'Approval' },
        config: {
          tool: 'human_in_the_loop',
          params: {
            inputFormat: [{ name: 'approved', type: 'boolean', required: true }],
            builderData: [{ id: 'display', name: 'question', type: 'string', value: 'Continue?' }],
          },
        },
      },
      {
        id: 'after',
        position: { x: 300, y: 0 },
        enabled: true,
        inputs: {},
        outputs: {},
        metadata: { id: 'response', name: 'After' },
        config: {
          tool: 'response',
          params: {
            dataMode: 'structured',
            builderData: [
              { id: 'status', name: 'status', type: 'number', value: `<${kind}.status>` },
            ],
          },
        },
      }
    )
    result.connections.push(
      { source: 'block1', target: 'approval', sourceHandle: 'error' },
      { source: 'approval', target: 'after' }
    )
  } else if (kind === 'router') {
    // A genuine connected target is needed before the route handler contacts the model.
    result.connections.push({ source: 'block1', target: 'trigger', sourceHandle: 'error' })
  }
  return result
}

function configureModel(kind: string) {
  const text = kind === 'evaluator' ? '{"accuracy":8}' : literal
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      state.contacts++
      return { content: [{ type: 'text', text }], finishReason: 'stop', usage, warnings: [] }
    },
    doStream: async () => {
      state.contacts++
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'text' })
            controller.enqueue({ type: 'text-delta', id: 'text', delta: text })
            controller.enqueue({ type: 'text-end', id: 'text' })
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage })
            controller.close()
          },
        }),
      }
    },
  })
}

function noOwnedReports(output: any) {
  for (const key of ['tokens', 'cost', 'toolCost', 'unavailableToolCosts', 'providerTiming'])
    expect(output).not.toHaveProperty(key)
}

it.each([
  ['agent', false],
  ['agent', true],
  ['evaluator', false],
  ['router', false],
] as const)(
  'retains real %s aggregate facts through Executor refusal/stream=%s and cold approval resume',
  async (kind, stream) => {
    configureModel(kind)
    const definition = workflow(kind, true)
    const contextExtensions = {
      workspaceId: 'workspace-1',
      userId: 'actor',
      workflowLogId: 'log-1',
      executionId: 'execution-1',
      stream,
      selectedOutputs: ['block1'],
    }
    const paused = await new Executor({ workflow: definition, contextExtensions }).execute(
      'workflow-1',
      'trigger'
    )
    expect(paused.status).toBe('paused')
    expect(state.contacts).toBe(1)
    expect(state.verify).toHaveBeenCalledTimes(1)
    const live = paused.logs!.find((log) => log.blockId === 'block1')!
    expect(live.success).toBe(false)
    expect(live.error).toContain('Original financial acceptance refused')
    expect(live.inference?.tokens).toEqual({ prompt: 2, completion: 3, total: 5 })
    expect(getInferenceFacts(live.output)).toBe(live.inference)
    expect(calculateCostSummary(buildTraceSpans(paused).traceSpans)).toMatchObject({
      totalTokens: 5,
      status: 'unavailable',
    })
    for (const block of projectFunctionalBlocks(buildTraceSpans(paused).traceSpans))
      if (block.output) noOwnedReports(block.output)
    expect(paused.checkpoint).toBeDefined()
    const initial = paused.checkpoint!
    noOwnedReports(initial.context.blockLogs.find((log) => log.blockId === 'block1')!.output)
    const savedState = initial.context.blockStates.find(([id]) => id === 'block1')![1]
    expect(savedState).toMatchObject({ success: false, executed: true, output: { status: 500 } })
    noOwnedReports(savedState.output)
    noOwnedReports(initial.finalOutput)
    // Exercise the existing explicit per-destination top-level projection as well.
    const snapshot = finalizeExecutorCheckpoint({
      ...initial,
      currentBlockStates: { ...initial.currentBlockStates, block1: live.output! },
      finalOutput: live.output!,
    })
    noOwnedReports(snapshot.currentBlockStates.block1)
    noOwnedReports(snapshot.finalOutput)
    const cold: WorkflowCheckpointSnapshot = JSON.parse(
      JSON.stringify({
        executor: snapshot,
        blueprint: { workflowId: 'workflow-1' },
        workflowLogId: 'log-1',
      })
    )
    expect(getInferenceFacts(cold.executor.currentBlockStates.block1)).toBeUndefined()
    await hydrateCheckpointFunctionalPayloads(cold, {
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      logId: 'log-1',
    })
    expect(
      cold.executor.context.blockStates.find(([id]) => id === 'block1')![1].output
    ).toMatchObject({ status: 500 })
    noOwnedReports(cold.executor.currentBlockStates.block1)
    if (kind === 'agent') {
      expect(state.payloads).toHaveLength(1)
      expect(JSON.stringify(state.payloads[0].payload.messages)).toContain(
        literal.replace(/\n/g, '\\n')
      )
      noOwnedReports(state.payloads[0].payload.output)
    }
    const resumed = await new Executor({
      workflow: cold.executor.workflow,
      checkpoint: cold.executor,
      currentBlockStates: cold.executor.currentBlockStates,
      resumeInputs: new Map([['approval', { approved: true }]]),
      contextExtensions: { ...contextExtensions, pendingExecutionId: 'execution-1:resume:1' },
    }).execute('workflow-1', 'trigger')
    expect(resumed.success).toBe(true)
    expect(resumed.logs?.find((log) => log.blockId === 'after')?.output).toMatchObject({
      response: { data: { status: 500 } },
    })
    expect(state.contacts).toBe(1)
    expect(state.verify).toHaveBeenCalledTimes(1)
    expect(state.payloads).toHaveLength(kind === 'agent' ? 1 : 0)
  }
)

it.each(['agent', 'evaluator', 'router'] as const)(
  'keeps genuine %s refusal without an error edge and never retries',
  async (kind) => {
    configureModel(kind)
    const definition = workflow(kind, false)
    if (kind === 'router') {
      definition.connections.pop()
      definition.blocks.push({
        id: 'target',
        position: { x: 300, y: 0 },
        enabled: true,
        inputs: {},
        outputs: {},
        metadata: { id: 'response', name: 'Target' },
        config: { tool: 'response', params: {} },
      })
      definition.connections.push({ source: 'block1', target: 'target' })
    }
    const result = await new Executor({
      workflow: definition,
      contextExtensions: {
        workspaceId: 'workspace-1',
        userId: 'actor',
        workflowLogId: 'log-1',
        executionId: 'execution-1',
      },
    }).execute('workflow-1', 'trigger')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Original financial acceptance refused')
    expect(
      getInferenceFacts(result.logs!.find((log) => log.blockId === 'block1')!.output)?.tokens?.total
    ).toBe(5)
    expect(state.contacts).toBe(1)
    expect(checkpointFunctionalOutput(result.logs)).toBeDefined()
  }
)
