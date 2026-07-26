import { describe, expect, it } from 'vitest'
import { sanitizePortfolioSnapshotParams } from '@/widgets/widgets/portfolio_snapshot/contract'

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'oauth-account-1',
  serviceId: 'alpaca-live',
  accountId: 'acct-1',
}

describe('sanitizePortfolioSnapshotParams', () => {
  it('sanitizes the persisted shape down to supported keys', () => {
    expect(
      sanitizePortfolioSnapshotParams({
        provider: 'alpaca',
        serviceId: 'alpaca-live',
        portfolioIdentity,
        selectedWindow: '1D',
        ignored: true,
        runtime: {
          refreshAt: 123,
          ignored: 'x',
        },
      })
    ).toEqual({
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      selectedWindow: '1D',
      runtime: {
        refreshAt: 123,
      },
    })
  })
})
