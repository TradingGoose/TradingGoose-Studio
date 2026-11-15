import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SleepClientTool } from './sleep'

const m = vi.hoisted(() => ({ assertion: vi.fn(), failure: vi.fn(), abort: new AbortController() }))
vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => ({
      abortController: m.abort,
      submitBrowserAssertion: m.assertion,
      recordToolFailure: m.failure,
      setToolState: vi.fn(),
    }),
  }),
}))
beforeEach(() => {
  vi.resetAllMocks()
  m.abort = new AbortController()
})
describe('native local timer completion', () => {
  it('actual abort interrupts active sleep without a timer.completed assertion or later completion', async () => {
    const tool = new SleepClientTool('timer')
    const running = tool.execute({ seconds: 60 })
    m.abort.abort(new DOMException('Cancelled by user', 'AbortError'))
    await running
    expect(m.failure).toHaveBeenCalledWith('timer', 'Cancelled by user')
    expect(m.assertion).not.toHaveBeenCalled()
    expect(tool.hasSubmittedResult()).toBe(false)
  })
  it('already aborted execution never claims successful timer completion', async () => {
    m.abort.abort(new DOMException('Aborted', 'AbortError'))
    const tool = new SleepClientTool('already-aborted')
    await tool.execute({ seconds: 0 })
    expect(m.failure).toHaveBeenCalledWith('already-aborted', 'Aborted')
    expect(m.assertion).not.toHaveBeenCalled()
    expect(tool.hasSubmittedResult()).toBe(false)
  })
})
