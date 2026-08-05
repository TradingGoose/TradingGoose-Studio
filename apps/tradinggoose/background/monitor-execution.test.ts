import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'

const mocks = vi.hoisted(() => ({
  indicator: vi.fn(),
  portfolio: vi.fn(),
  settle: vi.fn(),
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  settleIndicatorCalculationPendingExecution: mocks.settle,
}))
vi.mock('./indicator-monitor-execution', () => ({
  executeIndicatorMonitorJob: mocks.indicator,
  isIndicatorMonitorExecutionPayload: vi.fn(() => true),
}))
vi.mock('./portfolio-monitor-execution', () => ({
  executePortfolioMonitorJob: mocks.portfolio,
  isPortfolioMonitorExecutionPayload: vi.fn(() => true),
}))

import { executeMonitorJob } from './monitor-execution'

describe('executeMonitorJob', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    { success: true, executionId: 'later-workflow-1' },
    { success: true, skipped: 'no_output' },
  ])('settles only the indicator calculation row after success', async (result) => {
    mocks.indicator.mockResolvedValueOnce(result)
    await executeMonitorJob({
      source: INDICATOR_MONITOR_PROVIDER,
      executionId: 'calculation-1',
    } as never)
    expect(mocks.settle).toHaveBeenCalledOnce()
    expect(mocks.settle).toHaveBeenCalledWith('calculation-1')
    expect(mocks.settle).not.toHaveBeenCalledWith('later-workflow-1')
  })

  it('settles the calculation row and rethrows a calculation failure', async () => {
    mocks.indicator.mockRejectedValueOnce(new Error('calculation failed'))
    await expect(
      executeMonitorJob({
        source: INDICATOR_MONITOR_PROVIDER,
        executionId: 'calculation-1',
      } as never)
    ).rejects.toThrow('calculation failed')
    expect(mocks.settle).toHaveBeenCalledOnce()
    expect(mocks.settle).toHaveBeenCalledWith('calculation-1')
  })

  it('never settles portfolio workflow rows directly', async () => {
    mocks.portfolio.mockResolvedValueOnce({ success: true })
    await executeMonitorJob({
      source: PORTFOLIO_MONITOR_PROVIDER,
      executionId: 'portfolio-workflow-1',
    } as never)
    expect(mocks.settle).not.toHaveBeenCalled()
  })
})
