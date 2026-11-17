import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  trigger: vi.fn(),
  execute: vi.fn(),
  finalize: vi.fn(),
  copilot: vi.fn(),
  copilotFailure: vi.fn(),
}))
vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: m.trigger } }))
vi.mock('@/background/pending-execution-worker', () => ({
  executePendingExecutionRun: m.execute,
  finalizePendingExecutionRunFailure: m.finalize,
}))
vi.mock('@/lib/copilot/agent/worker', () => ({
  executeCopilotJob: m.copilot,
  finalizeCopilotExecution: m.copilotFailure,
}))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))

import {
  type BackgroundExecutionTaskPayload,
  dispatchBackgroundExecution,
} from './background-execution'

afterEach(() => vi.clearAllMocks())

describe('shared background dispatch', () => {
  it('dispatches Copilot directly to the dedicated Trigger task with its default duration', async () => {
    m.trigger.mockResolvedValueOnce({ id: 'trigger-run' })
    const job = {
      id: 'copilot-turn',
      executionType: 'copilot' as const,
      payload: { runId: 'native-run' },
    }
    await expect(dispatchBackgroundExecution(job, 'trigger')).resolves.toBe('trigger-run')
    expect(m.trigger).toHaveBeenCalledExactlyOnceWith('copilot-execution', job, {
      idempotencyKey: 'copilot-execution:copilot-turn',
    })
    expect(m.execute).not.toHaveBeenCalled()
  })

  it.each<BackgroundExecutionTaskPayload>([
    { id: 'local-copilot', executionType: 'copilot' as const, payload: {} },
    { pendingExecutionId: 'local-workflow', executionType: 'workflow' },
  ])('starts the shared local executor for $id$pendingExecutionId', async (job) => {
    let finish!: () => void
    const execute = job.executionType === 'copilot' ? m.copilot : m.execute
    execute.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    await dispatchBackgroundExecution(job, 'local')
    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledExactlyOnceWith(
        job.executionType === 'copilot' ? job.payload : job
      )
    )
    finish()
    expect(m.trigger).not.toHaveBeenCalled()
    expect(m.finalize).not.toHaveBeenCalled()
  })

  it.each<BackgroundExecutionTaskPayload>([
    { id: 'failed-turn', executionType: 'copilot', payload: {} },
    { pendingExecutionId: 'failed-document', executionType: 'document' },
  ])('finalizes a failed local $executionType execution', async (job) => {
    const error = new Error('Failed before inference')
    const execute = job.executionType === 'copilot' ? m.copilot : m.execute
    execute.mockRejectedValueOnce(error)
    await dispatchBackgroundExecution(job, 'local')
    await vi.waitFor(() => {
      if (job.executionType === 'copilot')
        expect(m.copilotFailure).toHaveBeenCalledWith(job.payload, error.message)
      else expect(m.finalize).toHaveBeenCalledWith(job, error, expect.any(Number))
    })
  })
})
