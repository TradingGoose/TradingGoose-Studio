import { describe, expect, it } from 'vitest'
import { getProviderOrderExternalUrl } from './provider-order-links'

describe('getProviderOrderExternalUrl', () => {
  it('does not guess Alpaca dashboard URLs', () => {
    expect(
      getProviderOrderExternalUrl({
        provider: 'alpaca',
        environment: 'paper',
        providerOrderId: 'order-1',
        accountId: 'acct-1',
      })
    ).toBeNull()
  })

  it('does not guess Tradier dashboard URLs', () => {
    expect(
      getProviderOrderExternalUrl({
        provider: 'tradier',
        environment: 'live',
        providerOrderId: 'order-2',
        accountId: 'acct-2',
      })
    ).toBeNull()
  })
})
