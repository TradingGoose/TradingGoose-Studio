import { describe, expect, it } from 'vitest'
import { sanitizeQuickOrderParams } from '@/widgets/widgets/quick_order/contract'

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'oauth-account-1',
  serviceId: 'alpaca-live',
  accountId: 'acct-1',
}

describe('sanitizeQuickOrderParams', () => {
  it('keeps only header-level quick order params', () => {
    expect(
      sanitizeQuickOrderParams({
        provider: ' alpaca ',
        marketProvider: ' yahoo-finance ',
        marketProviderParams: {
          region: 'US',
          apiKey: 'not-persisted-here',
        },
        marketAuth: {
          apiKey: 'market-key',
          apiSecret: 'market-secret',
        },
        serviceId: 'alpaca-live',
        portfolioIdentity,
        side: 'sell',
        quantity: 1,
      })
    ).toEqual({
      provider: 'alpaca',
      marketProvider: 'yahoo-finance',
      marketProviderParams: {
        region: 'US',
      },
      marketAuth: {
        apiKey: 'market-key',
        apiSecret: 'market-secret',
      },
      serviceId: 'alpaca-live',
      portfolioIdentity,
      side: 'sell',
    })
  })
})
