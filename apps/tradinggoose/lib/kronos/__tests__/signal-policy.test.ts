import { describe, expect, it } from 'vitest'
import { KronosSignalPolicy } from '../signal-policy'

describe('KronosSignalPolicy', () => {
  const policy = new KronosSignalPolicy({
    minTerminalReturn: 0.005,
    maxPredictedDrawdown: 0.02,
    maxRealizedVolatility: 0.6,
    allowFlip: true,
  })

  it('returns buy when forecast is positive and above threshold', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: 0.01,
      predictedPathDrawdown: 0.005,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.action).toBe('buy')
  })

  it('returns sell when forecast is negative and above threshold', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: -0.01,
      predictedPathDrawdown: 0.005,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.action).toBe('sell')
  })

  it('returns no_trade when terminal return is below threshold', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: 0.001,
      predictedPathDrawdown: 0.001,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.action).toBe('no_trade')
    expect(result.reason).toContain('below threshold')
  })

  it('returns no_trade when predicted drawdown exceeds limit', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: 0.01,
      predictedPathDrawdown: 0.05,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.action).toBe('no_trade')
    expect(result.reason).toContain('drawdown')
  })

  it('returns no_trade when realized volatility exceeds limit', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: 0.01,
      predictedPathDrawdown: 0.005,
      realizedVolatilityAnnualized: 0.8,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.action).toBe('no_trade')
    expect(result.reason).toContain('volatility')
  })

  it('returns no_trade when already holding the same side', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: 0.01,
      predictedPathDrawdown: 0.005,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'long',
      currentPositionQuantity: 10,
    })
    expect(result.action).toBe('no_trade')
    expect(result.reason).toContain('Already')
  })

  it('returns sell when flipping from long to short and allowFlip is true', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: -0.01,
      predictedPathDrawdown: 0.005,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'long',
      currentPositionQuantity: 10,
    })
    expect(result.action).toBe('sell')
  })

  it('returns no_trade when flipping is disallowed', () => {
    const noFlipPolicy = new KronosSignalPolicy({
      minTerminalReturn: 0.005,
      maxPredictedDrawdown: 0.02,
      maxRealizedVolatility: 0.6,
      allowFlip: false,
    })
    const result = noFlipPolicy.evaluate({
      forecastTerminalReturn: -0.01,
      predictedPathDrawdown: 0.005,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'long',
      currentPositionQuantity: 10,
    })
    expect(result.action).toBe('no_trade')
    expect(result.reason).toContain('Flip')
  })

  it('returns no_trade when forecast is exactly zero', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: 0,
      predictedPathDrawdown: 0.001,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.action).toBe('no_trade')
  })

  it('includes metadata in the result', () => {
    const result = policy.evaluate({
      forecastTerminalReturn: 0.01,
      predictedPathDrawdown: 0.005,
      realizedVolatilityAnnualized: 0.3,
      currentPositionSide: 'flat',
      currentPositionQuantity: 0,
    })
    expect(result.metadata.terminalReturn).toBe(0.01)
    expect(result.metadata.predictedDrawdown).toBe(0.005)
    expect(result.metadata.realizedVolatility).toBe(0.3)
    expect(result.expiresAt).toBeDefined()
  })
})
