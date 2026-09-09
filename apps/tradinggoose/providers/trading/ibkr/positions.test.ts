import { describe, expect, it } from 'vitest'
import { normalizeIbkrPositions } from '@/providers/trading/ibkr/positions'

const context = {
  providerId: 'ibkr' as const,
  credentialId: 'cred-1',
  serviceId: 'ibkr-paper',
}

describe('normalizeIbkrPositions', () => {
  it('normalizes long stock positions', () => {
    const positions = normalizeIbkrPositions(
      [
        {
          ticker: 'AAPL',
          assetClass: 'STK',
          position: 10,
          avgCost: 200,
          mktPrice: 210,
          mktValue: 2100,
          unrealizedPnl: 100,
          unrealizedPnlPercent: 0.05,
          multiplier: 1,
        },
      ],
      context
    )

    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({
      quantity: 10,
      side: 'long',
      averagePrice: 200,
      marketPrice: 210,
      marketValue: 2100,
      unrealizedPnl: 100,
      unrealizedPnlPercent: 5,
      multiplier: 1,
    })
  })

  it('normalizes short positions with negative quantity', () => {
    const positions = normalizeIbkrPositions(
      [
        {
          ticker: 'TSLA',
          assetClass: 'STK',
          position: -5,
          avgCost: 300,
          mktPrice: 290,
          mktValue: -1450,
          unrealizedPnl: 50,
        },
      ],
      context
    )

    expect(positions[0]?.side).toBe('short')
    expect(positions[0]?.quantity).toBe(-5)
  })

  it('skips unknown asset classes', () => {
    const positions = normalizeIbkrPositions(
      [
        {
          ticker: 'UNKNOWN',
          assetClass: 'OPTION',
          position: 1,
        },
      ],
      context
    )

    expect(positions).toHaveLength(0)
  })

  it('handles non-array input as empty', () => {
    expect(normalizeIbkrPositions(null, context)).toEqual([])
    expect(normalizeIbkrPositions(undefined, context)).toEqual([])
  })

  it('normalizes future positions with multiplier', () => {
    const positions = normalizeIbkrPositions(
      [
        {
          ticker: 'ES',
          assetClass: 'FUT',
          position: 2,
          mktValue: 100000,
          multiplier: 50,
        },
      ],
      context
    )

    expect(positions[0]?.assetClass ?? positions[0]?.multiplier).toBe(50)
    expect(positions[0]?.quantity).toBe(2)
  })
})
