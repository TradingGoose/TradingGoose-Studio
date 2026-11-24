/// <reference types="vite/client" />
/** @vitest-environment node */
import { expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ businessImports: vi.fn(), registered: vi.fn(), run: vi.fn() }))
vi.mock('@trigger.dev/sdk', () => ({
  task: (definition: { id: string }) => {
    m.registered(definition.id)
    return definition
  },
  timeout: { None: 2_147_483_647 },
  defineConfig: (config: unknown) => config,
}))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/copilot/agent/worker', () => {
  m.businessImports('copilot')
  return { executeCopilotJob: () => m.run('copilot') }
})
vi.mock('./pending-execution-worker', () => {
  m.businessImports('pending')
  return {
    executePendingExecutionRun: async ({
      pendingExecutionId,
      executionType,
    }: {
      pendingExecutionId: string
      executionType: import('@/lib/execution/pending-execution').PendingExecutionType
    }) => {
      const { executeBackgroundExecution } = await import('./execution-job')
      return executeBackgroundExecution({ id: pendingExecutionId, executionType, payload: {} })
    },
  }
})
vi.mock('./workflow-execution', () => {
  m.businessImports('workflow')
  return { isWorkflowExecutionPayload: () => true, executeWorkflowJob: () => m.run('workflow') }
})
vi.mock('./webhook-execution', () => {
  m.businessImports('webhook')
  return { isWebhookExecutionPayload: () => true, executeWebhookJob: () => m.run('webhook') }
})
vi.mock('./schedule-execution', () => {
  m.businessImports('schedule')
  return { isScheduleExecutionPayload: () => true, executeScheduleJob: () => m.run('schedule') }
})
vi.mock('./monitor-execution', () => {
  m.businessImports('monitor')
  return { executeMonitorJob: () => m.run('monitor') }
})
vi.mock('./knowledge-processing', () => {
  m.businessImports('document')
  return { executeDocumentProcessingJob: () => m.run('document') }
})
vi.mock('./logs-webhook-delivery', () => {
  m.businessImports('delivery')
  throw new Error('Eager log delivery import')
})

const entries = import.meta.glob('./tasks/*.ts')
const taskIds = [
  'copilot-execution',
  'knowledge-process-document',
  'logs-webhook-delivery',
  'monitor-execution',
  'pending-execution',
  'schedule-execution',
  'webhook-execution',
  'workflow-execution',
]

it('indexes the configured registration directory without loading any execution runner', async () => {
  vi.resetModules()
  m.registered.mockClear()
  m.businessImports.mockClear()
  expect((await import('../trigger.config')).default.dirs).toEqual(['./background/tasks'])
  for (const load of Object.values(entries)) await load()
  expect(m.registered.mock.calls.map(([id]) => id).sort()).toEqual(taskIds)
  expect(m.businessImports).not.toHaveBeenCalled()
  const { documentExecutionTask } = await import('./tasks/document-execution')
  expect(documentExecutionTask).toMatchObject({ machine: 'large-1x' })
  expect(documentExecutionTask).not.toHaveProperty('maxDuration')
})

it('keeps emitted lazy chunks out of the Trigger index', async () => {
  const { build } = (await import('../trigger.config')).default
  const extension = build?.extensions?.find(({ name }) => name === 'trigger-index-entry-points')
  const registerPlugin = vi.fn()
  await extension!.onBuildStart!({ registerPlugin } as never)
  const registration = 'background/tasks/workflow-execution.ts'
  const engine = 'background/workflow-execution.ts'
  const worker = '/cli/managed-index-worker.js'
  const onEnd = vi.fn()
  registerPlugin.mock.calls[0][0].setup({
    initialOptions: { absWorkingDir: '/app', entryPoints: [worker, registration] },
    onEnd,
  })
  const outputs = {
    'worker.mjs': { entryPoint: worker },
    'workflow.mjs': { entryPoint: registration },
    'chunk-engine.mjs': { entryPoint: engine, bytes: 123 },
  }
  onEnd.mock.calls[0][0]({ metafile: { outputs } })
  expect(outputs).toEqual({
    'worker.mjs': { entryPoint: worker },
    'workflow.mjs': { entryPoint: registration },
    'chunk-engine.mjs': { bytes: 123 },
  })
})

it('rejects an invalid pending ID before loading an execution runner', async () => {
  const { workflowExecutionTask } = await import('./tasks/workflow-execution')
  m.businessImports.mockClear()
  await expect(
    (workflowExecutionTask as any).run({ executionType: 'copilot', id: 'foreign', payload: {} }, {})
  ).rejects.toThrow('Missing pending execution ID')
  expect(m.businessImports).not.toHaveBeenCalled()
})

it.each(['workflow', 'webhook', 'schedule', 'monitor', 'document', 'copilot'] as const)(
  'invokes only the selected %s engine from its own registration',
  async (kind) => {
    m.businessImports.mockClear()
    m.run.mockClear()
    const module = (await entries[`./tasks/${kind}-execution.ts`]()) as Record<
      string,
      { run: (payload: unknown, context: Record<string, never>) => Promise<unknown> }
    >
    const [registered] = Object.values(module)
    const payload =
      kind === 'copilot'
        ? { executionType: 'copilot', id: 'direct', payload: {} }
        : { pendingExecutionId: 'row' }
    await registered.run(payload, {})
    expect(m.run).toHaveBeenCalledExactlyOnceWith(kind)
    expect(
      m.businessImports.mock.calls.map(([name]) => name).filter((name) => name !== 'pending')
    ).toEqual([kind])
  }
)
