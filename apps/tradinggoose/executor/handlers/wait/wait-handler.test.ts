import { describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { WaitBlockHandler } from './wait-handler'

const block = {
  id: 'wait-1',
  metadata: { id: BlockType.WAIT, name: 'Wait' },
} as SerializedBlock

describe('WaitBlockHandler', () => {
  it('returns completed after the timer elapses', async () => {
    vi.useFakeTimers()
    const result = new WaitBlockHandler().execute(
      block,
      { timeValue: '1', timeUnit: 'seconds' },
      {} as ExecutionContext
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toEqual({ waitDuration: 1_000, status: 'completed' })
    vi.useRealTimers()
  })

  it('rejects when the workflow deadline cancels the local wait', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const result = new WaitBlockHandler().execute(block, { timeValue: '10', timeUnit: 'seconds' }, {
      workflowDeadlineSignal: controller.signal,
    } as ExecutionContext)
    controller.abort()
    await expect(result).rejects.toThrow('Workflow wait was canceled')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
