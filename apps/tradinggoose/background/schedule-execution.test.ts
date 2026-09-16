import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeScheduleJob, type ScheduleExecutionPayload } from './schedule-execution'

const mocks = vi.hoisted(() => ({
  runPreparedWorkflowExecution: vi.fn(),
  loadWorkflowExecutionBlueprint: vi.fn(),
  nextRunAt: new Date('2026-09-16T13:00:00.000Z'),
  set: vi.fn(),
  updateWhere: vi.fn(),
  delete: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  workflow: { id: 'workflow.id' },
  workflowSchedule: { id: 'workflowSchedule.id' },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            { id: 'workflow-1', workspaceId: 'workspace-1', pinnedApiKeyId: 'key-1' },
          ],
        }),
      }),
    }),
    update: () => ({ set: mocks.set }),
    delete: mocks.delete,
  },
}))
vi.mock('@/lib/api-key/service', () => ({ getApiKeyOwnerUserId: async () => 'actor-1' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: mocks.info, warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/schedules/utils', () => ({
  getSubBlockValue: () => 'hourly',
  getScheduleTimeValues: () => ({}),
  calculateNextRunTime: () => mocks.nextRunAt,
}))
vi.mock('@/lib/timezone/timezone-resolver', () => ({
  resolveTimezoneOffsetMinutes: async () => 0,
}))
vi.mock('@/lib/workflows/db-helpers', () => ({ loadDeployedWorkflowState: vi.fn() }))
vi.mock('@/lib/workflows/execution-runner', () => ({
  loadWorkflowExecutionBlueprint: mocks.loadWorkflowExecutionBlueprint,
  runPreparedWorkflowExecution: mocks.runPreparedWorkflowExecution,
  WorkflowUsageLimitError: class WorkflowUsageLimitError extends Error {},
}))

const payload = {
  executionId: 'execution-1',
  scheduleId: 'schedule-1',
  workflowId: 'workflow-1',
  blockId: 'trigger-1',
  timezone: 'UTC',
  now: '2026-09-16T12:00:00.000Z',
  failedCount: 2,
} satisfies ScheduleExecutionPayload

describe('executeScheduleJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.set.mockReturnValue({ where: mocks.updateWhere })
    mocks.updateWhere.mockResolvedValue(undefined)
    mocks.loadWorkflowExecutionBlueprint.mockResolvedValue({
      workflowContext: { workspaceId: 'workspace-1' },
      workflowData: { blocks: { 'trigger-1': {} } },
    })
  })

  it.each([undefined, 'paused'] as const)(
    'advances an accepted schedule without disabling it when status is %s',
    async (status) => {
      mocks.runPreparedWorkflowExecution.mockResolvedValue({
        result: { success: true, status, output: {} },
      })

      await expect(executeScheduleJob(payload)).resolves.toBeUndefined()

      expect(mocks.runPreparedWorkflowExecution).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          executionId: 'execution-1',
          actorUserId: 'actor-1',
          triggerType: 'schedule',
          triggerTarget: { kind: 'block', blockId: 'trigger-1' },
        })
      )
      expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
        updatedAt: new Date(payload.now),
        nextRunAt: mocks.nextRunAt,
        lastRanAt: new Date(payload.now),
        failedCount: 0,
      })
      expect(mocks.delete).not.toHaveBeenCalled()
      expect(mocks.info).toHaveBeenLastCalledWith(
        `[executio] Workflow workflow-1 ${status ?? 'executed successfully'}`
      )
    }
  )

  it('still counts real execution failures and disables at the configured threshold', async () => {
    mocks.runPreparedWorkflowExecution.mockResolvedValue({ result: { success: false, output: {} } })

    await executeScheduleJob(payload)

    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({
      updatedAt: new Date(payload.now),
      nextRunAt: mocks.nextRunAt,
      lastFailedAt: new Date(payload.now),
      failedCount: 3,
      status: 'disabled',
    })
  })
})
