import { describe, expect, it } from 'vitest'
import { resolveActiveTradingCredentialServiceId } from '@/widgets/widgets/components/trading-credential-services'

describe('resolveActiveTradingCredentialServiceId', () => {
  it('keeps a requested service only when it is connected', () => {
    expect(
      resolveActiveTradingCredentialServiceId({
        credentialServiceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-live', 'alpaca-paper'],
      })
    ).toBe('alpaca-live')
  })

  it('moves from a disconnected requested service to the only connected service', () => {
    expect(
      resolveActiveTradingCredentialServiceId({
        credentialServiceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-paper'],
      })
    ).toBe('alpaca-paper')
  })

  it('requires a user choice when multiple connected services remain', () => {
    expect(
      resolveActiveTradingCredentialServiceId({
        credentialServiceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-paper', 'alpaca-sandbox'],
      })
    ).toBeUndefined()
  })

  it('does not activate a disconnected single-service provider', () => {
    expect(
      resolveActiveTradingCredentialServiceId({
        credentialServiceId: 'tradier-live',
        connectedServiceIds: [],
      })
    ).toBeUndefined()
  })
})
