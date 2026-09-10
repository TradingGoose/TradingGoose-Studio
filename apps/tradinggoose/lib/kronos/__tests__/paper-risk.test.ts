import { describe, expect, it } from 'vitest'
import { PaperRiskManager, deriveForecastSignalInput } from '../paper-risk'

describe('PaperRiskManager', () => {
  const risk = new PaperRiskManager({
    maxQuantityPerSymbol: 100,
    maxGrossExposure: 300,
    maxNetExposure: 150,
    maxOrdersPerHour: 6,
    cooldownMs: 5 * 60_000,
    dailyLossLimitFraction: 0.02,
    startingCapital: 100_000,
  })

  it('approves a valid order within limits', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 10,
      symbol: 'AAPL',
      currentPositions: new Map([['MSFT', 50]]),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(true)
    expect(result.reason).toBe('Risk checks passed')
  })

  it('rejects when daily loss limit reached', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 10,
      symbol: 'AAPL',
      currentPositions: new Map(),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: -3000,
    })
    expect(result.approved).toBe(false)
    expect(result.reason).toContain('loss limit')
  })

  it('rejects during cooldown', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 10,
      symbol: 'AAPL',
      currentPositions: new Map(),
      orderHistory: [],
      lastSignalAt: Date.now() - 30_000, // 30 seconds ago
      dailyPnL: 0,
    })
    expect(result.approved).toBe(false)
    expect(result.reason).toContain('Cooldown')
  })

  it('rejects when orders per hour limit reached', () => {
    const now = Date.now()
    const orderHistory = Array.from({ length: 6 }, (_, i) => ({
      timestamp: now - i * 5 * 60_000,
      side: 'buy' as const,
      quantity: 10,
    }))
    const result = risk.check({
      action: 'buy',
      quantity: 10,
      symbol: 'AAPL',
      currentPositions: new Map(),
      orderHistory,
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(false)
    expect(result.reason).toContain('hour limit')
  })

  it('rejects when per-symbol limit cannot be satisfied even with adjustment', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 20,
      symbol: 'AAPL',
      currentPositions: new Map([['AAPL', 100]]),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(false)
    expect(result.reason).toContain('Per-symbol limit')
  })

  it('adjusts quantity to stay within per-symbol limit', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 10,
      symbol: 'AAPL',
      currentPositions: new Map([['AAPL', 95]]),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(true)
    expect(result.adjustedQuantity).toBe(5)
  })

  it('rejects when gross exposure exceeded', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 100,
      symbol: 'AAPL',
      currentPositions: new Map([['MSFT', 150], ['GOOGL', 150]]),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(false)
    expect(result.reason).toContain('Gross exposure')
  })

  it('rejects when net exposure exceeded', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 100,
      symbol: 'AAPL',
      currentPositions: new Map([['MSFT', 100]]),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(false)
    expect(result.reason).toContain('Net exposure')
  })

  it('approves selling to reduce position', () => {
    const result = risk.check({
      action: 'sell',
      quantity: 50,
      symbol: 'AAPL',
      currentPositions: new Map([['AAPL', 100], ['MSFT', 50]]),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(true)
  })

  it('approves when under both gross and net exposure limits', () => {
    const result = risk.check({
      action: 'buy',
      quantity: 50,
      symbol: 'AAPL',
      currentPositions: new Map([['MSFT', 50], ['GOOGL', 50]]),
      orderHistory: [],
      lastSignalAt: null,
      dailyPnL: 0,
    })
    expect(result.approved).toBe(true)
  })
})

describe('deriveForecastSignalInput', () => {
  it('calculates terminal return correctly', () => {
    const result = deriveForecastSignalInput({
      lastClose: 100,
      predictedClose: 102,
      predictedPath: [{ high: 103, low: 99 }],
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.forecastTerminalReturn).toBeCloseTo(0.02, 5)
  })

  it('calculates predicted path drawdown', () => {
    const result = deriveForecastSignalInput({
      lastClose: 100,
      predictedClose: 102,
      predictedPath: [{ high: 103, low: 95 }],
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.predictedPathDrawdown).toBeCloseTo(0.05, 5)
  })

  it('handles zero lastClose gracefully', () => {
    const result = deriveForecastSignalInput({
      lastClose: 0,
      predictedClose: 0,
      predictedPath: [{ high: 0, low: 0 }],
      realizedVolatilityAnnualized: 0,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.forecastTerminalReturn).toBe(0)
    expect(result.predictedPathDrawdown).toBe(0)
  })

  it('preserves position information', () => {
    const result = deriveForecastSignalInput({
      lastClose: 100,
      predictedClose: 101,
      predictedPath: [{ high: 102, low: 99 }],
      realizedVolatilityAnnualized: 0.4,
      currentPositionSide: 'long',
      currentPositionQuantity: 10,
    })
    expect(result.currentPositionSide).toBe('long')
    expect(result.currentPositionQuantity).toBe(10)
    expect(result.realizedVolatilityAnnualized).toBe(0.4)
  })

  it('handles negative terminal return', () => {
    const result = deriveForecastSignalInput({
      lastClose: 100,
      predictedClose: 98,
      predictedPath: [{ high: 101, low: 97 }],
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.forecastTerminalReturn).toBeCloseTo(-0.02, 5)
  })

  it('calculates maximum drawdown across multiple bars', () => {
    const result = deriveForecastSignalInput({
      lastClose: 100,
      predictedClose: 105,
      predictedPath: [
        { high: 106, low: 99 },
        { high: 107, low: 94 },
        { high: 108, low: 101 },
      ],
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.predictedPathDrawdown).toBeCloseTo(0.06, 5)
  })
})
