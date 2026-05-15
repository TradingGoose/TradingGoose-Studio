import { describe, expect, it } from 'vitest'
import { resolveActiveTradingServiceId } from '@/widgets/widgets/components/trading-services'

describe('resolveActiveTradingServiceId', () => {
  it('keeps a requested service only when it is connected', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-live', 'alpaca-paper'],
      })
    ).toBe('alpaca-live')
  })

  it('moves from a disconnected requested service to the only connected service', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-paper'],
      })
    ).toBe('alpaca-paper')
  })

  it('requires a user choice when multiple connected services remain', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-paper', 'alpaca-sandbox'],
      })
    ).toBeUndefined()
  })

  it('does not activate a disconnected single-service provider', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'tradier-live',
        connectedServiceIds: [],
      })
    ).toBeUndefined()
  })
})
